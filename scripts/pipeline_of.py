# -*- coding: utf-8 -*-
"""
Pipeline automatizado da Oferta Futura (roda no GitHub Actions ou localmente).

Fluxo:
  1. Lê os empreendimentos OF do SQL Server (Portal Inteligência de Mercado),
     reproduzindo o export "empreendimentos_OF.xlsx" (ativos, regional GO).
  2. Lê a síntese consolidada do Neon (tabela sintese_consolidada).
  3. Aplica a mesma lógica do script_consolidado_OF.v2.py:
     curvas de venda por cluster -> projeção OF 18 meses -> extensão da síntese
     -> tabela master unificada (grão duplo).
  4. Grava a master no Neon (tabela projecao_of) e gera data/dados_of.js
     + data/mapa_of.js via scripts/preprocess.py (o dashboard lê esses arquivos;
     o commit do workflow dispara o deploy automático no Vercel).

Parâmetros (variáveis de ambiente):
  OF_DATA_BASE    mm/aaaa  data base da projeção                (padrão 01/2026)
  FATOR_AJUSTE    float    fator multiplicador da curva          (padrão 1.0)
  OF_MANTER_PARAMETROS  1 reutiliza data base e fator gravados no Neon (botão do site)

A data base é o único parâmetro de período. Dela saem os três prazos que o pipeline
usa, todos amarrados aos 18 meses da curva de venda:
  - início da janela de lançamentos OF = a própria data base
  - fim da janela de lançamentos OF    = data base + 18 meses (mês inteiro)
  - fim da projeção da síntese         = data base + 18 meses
Exemplo: OF_DATA_BASE=03/2026 -> janela 03/2026 a 09/2027.
"""
import os
import re
from datetime import datetime

import numpy as np
import pandas as pd
from pandas.tseries.offsets import DateOffset

import preprocess
from of_common import load_env, neon_connect, sqlserver_connect, copy_dataframe, set_meta

# ================= premissas (idênticas ao script_consolidado_OF.v2) =================
MAPA_TIPOLOGIA = {
    'STUDIO': 1, '1Q': 1, '2Q': 2, '2Q C/1S': 2, '2S': 2,
    '3Q': 3, '3Q C/1S': 3, '3Q C/2S': 3, '3S': 3,
    '4S': 4, '4Q C/1S': 4, '4Q C/2S': 4, '4Q C/3S': 4, '>4S': 4,
}

COLUNAS_ORDEM_FINAL_OF = [
    'id_tipologia', 'id_empreendimento', 'cidade', 'bairro', 'incorporadora',
    'TipoEmpreendimento', 'empreendimento', 'datainobr', 'datahabt', 'regional',
    'incorpOUconsorcio', 'TotalUnidades', 'Unids_tipologia', 'AreaPrivativa',
    'unidadesvendidasmes', 'unidadesdistratadasmes', 'unidadesdisponiveis',
    'tipologia_tratada', 'dtlançamento', 'data', 'macrozona', 'Latitude',
    'Longitude', 'descPavimentos', 'CidadeId', 'BairroId', 'Logradouro',
    'AreaTerreno', 'Adensamento', 'MCMV', 'Observacao', 'DadosExtras',
    'Complemento', 'TerrenoTapumado', 'ProjetoProtocolado', 'ProjetoProtocoladoOutros',
    'ProjetoAprovado', 'IdProtocoloProjeto', 'IdProtocoloProjetoOutros',
    'DataProtocoloProjeto', 'DataProtocoloProjetoOutros', 'LinkDoProjeto',
    'IPTU', 'DataAprovacao', 'DataRemembramentoDesmembramento', 'FonteEmpreendimento', 'FonteDataLancamento',
    'FonteTipologia', 'FonteDataPrevisaoLancamento', 'Cidade.Uf', 'Cidade.Regional',
    'Consorcio.Id', 'tipologia', 'consideracao_OF', 'cluster', 'LinkPortal',
]

# Query que reproduz o export empreendimentos_OF.xlsx:
# tipologias ativas de cadastros ativos nas cidades da regional GO
# (Goiânia, Aparecida de Goiânia, Senador Canedo). tipologia = PerfilTipologia.
# O Portal removeu os três flags ProjetoProtocolado/Outros e ProjetoAprovado.
# Mantemos NULL nos aliases legados; datas e IDs continuam vindo do cadastro.
SQL_EMPREENDIMENTOS = """
SELECT
    c.Nome                    AS [Cidade.Nome],
    b.Nome                    AS [Bairro.Nome],
    ec.Id                     AS Id_empreendimento,
    ec.Empreendimento         AS Empreendimento,
    i.Nome                    AS [Incorporadora.Nome],
    ec.DataLancamento         AS dtlancamento,
    ec.DataPrevisaoLancamento AS DataPrevisaoLancamento,
    ec.DescricaoDosPavimentos AS DescricaoDosPavimentos,
    ec.CidadeId               AS CidadeId,
    ec.BairroId               AS BairroId,
    ec.Logradouro             AS Logradouro,
    ec.Latitude               AS Latitude,
    ec.Longitude              AS Longitude,
    ec.TipoEmpreendimento     AS TipoEmpreendimento,
    ec.TotalUnidades          AS TotalUnidades,
    t.UnidadesTipologia       AS Unids_tipologia,
    t.AreaPrivativa           AS AreaPrivativa,
    t.PerfilTipologia         AS tipologia,
    t.NumeroQuartos           AS NumeroQuartos,
    ec.AreaTerreno            AS AreaTerreno,
    ec.Adensamento            AS Adensamento,
    ec.MCMV                   AS MCMV,
    ec.MacroRegiao            AS MacroRegiao,
    ec.Observacao             AS Observacao,
    ec.DadosExtras            AS DadosExtras,
    ec.Complemento            AS Complemento,
    ec.TerrenoTapumado        AS TerrenoTapumado,
    CAST(NULL AS bit)         AS ProjetoProtocolado,
    CAST(NULL AS bit)         AS ProjetoProtocoladoOutros,
    CAST(NULL AS bit)         AS ProjetoAprovado,
    ec.IdProtocoloProjeto     AS IdProtocoloProjeto,
    ec.IdProtocoloProjetoOutros AS IdProtocoloProjetoOutros,
    ec.DataProtocoloProjeto   AS DataProtocoloProjeto,
    ec.DataProtocoloProjetoOutros AS DataProtocoloProjetoOutros,
    ec.LinkDoProjeto          AS LinkDoProjeto,
    ec.IPTU                   AS IPTU,
    ec.DataAprovacao          AS DataAprovacao,
    ec.DataRemembramentoDesmembramento AS DataRemembramentoDesmembramento,
    ec.FonteEmpreendimento    AS FonteEmpreendimento,
    ec.FonteDataLancamento    AS FonteDataLancamento,
    -- a tela de edição do portal grava a fonte no CADASTRO; a cópia por tipologia
    -- não é sincronizada pelo sistema (68 linhas divergentes em 07/2026) — o cadastro manda
    COALESCE(NULLIF(LTRIM(RTRIM(ec.FonteTipologia)), ''), t.FonteTipologia) AS FonteTipologia,
    ec.FonteDataPrevisaoLancamento AS FonteDataPrevisaoLancamento,
    c.Uf                      AS [Cidade.Uf],
    c.Regional                AS [Cidade.Regional],
    co.Id                     AS [Consorcio.Id],
    co.Nome                   AS [Consorcio.Nome],
    t.Id                      AS [EmpreendimentoTipologia.Id],
    t.ConsideracaoOF          AS [EmpreendimentoTipologia.ConsideracaoOF]
FROM dbo.EmpreendimentoTipologia t
JOIN dbo.EmpreendimentoCadastro ec ON ec.Id = t.EmpreendimentoCadastroId
JOIN dbo.Cidade c        ON c.Id = ec.CidadeId
LEFT JOIN dbo.Bairro b   ON b.Id = ec.BairroId
LEFT JOIN dbo.Incorporadora i ON i.Id = ec.IncorporadoraId
LEFT JOIN dbo.Consorcio co    ON co.Id = ec.ConsorcioId
WHERE t.Inativo = 0 AND ec.Inativo = 0 AND c.Regional = 'GO'
"""

TIPOS_PG = {
    'id_tipologia': 'double precision', 'id_empreendimento': 'double precision',
    'TotalUnidades': 'double precision', 'Unids_tipologia': 'double precision',
    'AreaPrivativa': 'double precision', 'unidadesvendidasmes': 'double precision',
    'unidadesdistratadasmes': 'double precision', 'unidadesdisponiveis': 'double precision',
    'tipologia_tratada': 'double precision', 'dtlançamento': 'date', 'data': 'date',
    'Latitude': 'double precision', 'Longitude': 'double precision',
    'CidadeId': 'double precision', 'BairroId': 'double precision',
    'AreaTerreno': 'double precision', 'Adensamento': 'double precision',
}


# a curva de venda tem 18 meses de vida; a janela de lançamentos acompanha esse prazo
MESES_CURVA = 18
JANELAS_CURVA = [3, 6, 9, 12, 15, 18]     # etapas de vida em que o % vendido é medido
MESES_HISTORICO = 36                       # só lançamentos dos últimos 36M da data base
CURVA_COLS = [f'%{m}M' for m in range(1, MESES_CURVA + 1)]
# grão de produto da síntese: inclui a incorporadora de propósito — em consórcio o
# mesmo empreendimento tem uma linha por membro e o estoque oficial soma todas
# (13.107 un em 03/2026, validado contra a planilha). Com a incorporadora no grão,
# numerador e denominador da curva contam do mesmo jeito que o estoque.
ID_COLS_SINTESE = ['empreendimento', 'tipologia', 'privativa', 'incorporadora']


def mes_ano(txt, rotulo='data base'):
    """'03/2026' -> datetime(2026, 3, 1). Aceita também '2026-03'."""
    txt = str(txt).strip()
    for fmt in ('%m/%Y', '%Y-%m'):
        try:
            return datetime.strptime(txt, fmt)
        except ValueError:
            pass
    raise SystemExit(f'{rotulo} inválida: {txt!r}. Use mm/aaaa, por exemplo 03/2026.')


def _curva_incremental(produtos, vendas, incs_global=None):
    """Curva de uma coorte: % do estoque vendido por etapa de vida (3, 6, ... 18 meses).

    Cada etapa usa SÓ os produtos que já viveram até ali (vida_obs >= etapa): um
    produto com 7 meses de vida entra nas etapas de 3M e 6M e é DESCONSIDERADO das
    seguintes — antes ele entrava com venda zero e achatava a curva inteira.
    O incremento da etapa é venda da janela / estoque de quem observa a janela;
    o acumulado é a soma dos incrementos, monotônico por construção.

    incs_global: incrementos do mercado para etapa sem nenhum observador no cluster.
    Devolve (dict %1M..%18M mensal, dict acumulado por etapa, dict n de produtos)."""
    mensal, acum_etapas, n_obs = {}, {}, {}
    acum = 0.0
    for j in JANELAS_CURVA:
        ok = produtos[produtos['vida_obs'] >= j]
        tot = ok['totalunidades'].sum()
        if len(ok) and tot > 0:
            v = vendas.merge(ok[ID_COLS_SINTESE], on=ID_COLS_SINTESE)
            bruto = v[(v['vida_mes'] > j - 3) & (v['vida_mes'] <= j)]['venda_liquida'].sum() / tot
            inc = max(float(bruto), 0.0)          # distrato líquido não desfaz venda passada
        elif incs_global is not None:
            inc = incs_global[j]                   # etapa sem observador segue o mercado
        else:
            inc = 0.0
        inc = min(inc, 1.0 - acum)                 # nunca vende mais que 100% do estoque
        acum += inc
        acum_etapas[j], n_obs[j] = acum, len(ok)
        for m in range(j - 2, j + 1):
            mensal[f'%{m}M'] = inc / 3
    return mensal, acum_etapas, n_obs


def curvas_de_venda(df_s, dt_base, fator_ajuste):
    """Curvas por cluster + curva global do mercado, a partir da síntese mensal.

    Método (validado com o usuário):
      1. Grão de produto = empreendimento+tipologia+privativa+incorporadora.
      2. Coorte = lançados nos últimos MESES_HISTORICO meses até a data base; a vida
         de cada produto conta do lançamento e só até a data base.
      3. % vendido por etapa de vida (3..18M) por cluster, etapa a etapa, contando em
         cada uma apenas os produtos que a observaram por inteiro.
      4. Cluster sem histórico e produto fora dos clusters APART seguem a curva global.

    Devolve (curvas_por_cluster, curva_global_mensal, resumo_para_log)."""
    prod = (df_s.sort_values('data').groupby(ID_COLS_SINTESE, dropna=False)
            .agg(datalancamento=('datalancamento', 'first'),
                 totalunidades=('totalunidades', 'first'),
                 cluster=('cluster', 'first'), max_data=('data', 'max'))
            .reset_index())
    ini = dt_base - DateOffset(months=MESES_HISTORICO)
    coorte = prod[(prod['datalancamento'] >= ini) & (prod['datalancamento'] <= dt_base)].copy()
    fim_obs = coorte['max_data'].clip(upper=pd.Timestamp(dt_base))
    coorte['vida_obs'] = ((fim_obs.dt.year - coorte['datalancamento'].dt.year) * 12 +
                          (fim_obs.dt.month - coorte['datalancamento'].dt.month) + 1)

    vendas = df_s.merge(coorte[ID_COLS_SINTESE + ['datalancamento']].rename(
        columns={'datalancamento': '_lancto'}), on=ID_COLS_SINTESE)
    vendas['vida_mes'] = ((vendas['data'].dt.year - vendas['_lancto'].dt.year) * 12 +
                          (vendas['data'].dt.month - vendas['_lancto'].dt.month) + 1)
    vendas = vendas[(vendas['vida_mes'] >= 1) & (vendas['data'] <= pd.Timestamp(dt_base))]

    global_mensal, global_acum, _ = _curva_incremental(coorte, vendas)
    incs_global = {j: global_acum[j] - global_acum.get(j - 3, 0.0) for j in JANELAS_CURVA}

    curvas, log = {}, [f'    global: 12M={global_acum[12]*100:.1f}% 18M={global_acum[18]*100:.1f}% '
                       f'({len(coorte)} produtos na coorte {ini:%m/%Y}-{dt_base:%m/%Y})']
    for cl in sorted(coorte['cluster'].dropna().unique()):
        if cl == 'outros':
            continue  # residual (comercial, casas, lotes) não vira curva: previsto fora dos APART segue o mercado
        mensal, acum, n_obs = _curva_incremental(coorte[coorte['cluster'] == cl], vendas, incs_global)
        curvas[cl] = {c: mensal[c] * fator_ajuste for c in CURVA_COLS}
        log.append(f'    {cl}: 12M={acum[12]*100:.1f}% 18M={acum[18]*100:.1f}% '
                   f'({n_obs[3]}→{n_obs[18]} produtos por etapa)')
    curva_padrao = {c: global_mensal[c] * fator_ajuste for c in CURVA_COLS}
    return curvas, curva_padrao, log


def validar_vso(df_s, dt_base, prod):
    """VSO clássica de 12 meses: vendas líquidas / (estoque inicial + lançado no período).

    Régua do usuário: mercado saudável fica entre 40% e 50%. Fora disso o pipeline
    avisa mas não aborta — pode ser um ciclo de mercado atípico de verdade."""
    ini = pd.Timestamp(dt_base) - DateOffset(months=11)
    vendas12 = df_s[(df_s['data'] >= ini) & (df_s['data'] <= pd.Timestamp(dt_base))]['venda_liquida'].sum()
    est_ini = df_s[df_s['data'] == ini - DateOffset(months=1)]['unidadesdisponiveis'].sum()
    lancado = prod[(prod['datalancamento'] >= ini) &
                   (prod['datalancamento'] <= pd.Timestamp(dt_base))]['totalunidades'].sum()
    oferta = est_ini + lancado
    vso = vendas12 / oferta if oferta else float('nan')
    estoque_base = df_s[df_s['data'] == pd.Timestamp(dt_base)]['unidadesdisponiveis'].sum()
    print(f'  VSO 12M do mercado: {vendas12:,.0f} vendas / {oferta:,.0f} oferta = {vso*100:.1f}%'
          + ('' if 0.40 <= vso <= 0.50 else '  << FORA da régua 40-50%, confira a base'))
    print(f'  estoque na data base ({pd.Timestamp(dt_base):%m/%Y}): {estoque_base:,.0f} unidades')
    return vso, estoque_base


def definir_cluster(tipo, quartos):
    tipo_str = str(tipo).upper().strip()
    try:
        q = float(quartos)
    except Exception:
        q = 0
    if 'APART - MAP' in tipo_str:
        if q == 1: return 'apart-map-1Q'
        elif q == 2: return 'apart-map-2Q'
        elif q == 3: return 'apart-map-3Q'
        elif q >= 4: return 'apart-map-4Qmaior'
    elif 'APART - ECO' in tipo_str:
        return 'apart-eco'
    return 'outros'


def ajustar_contexto_sintese(df):
    """Renomeia as colunas da síntese para o vocabulário da master."""
    mapa = {
        'latitude': 'Latitude', 'longitude': 'Longitude',
        'datalancamento': 'dtlançamento', 'macroregiao': 'macrozona',
        'privativa': 'AreaPrivativa', 'tipoempreendimento': 'TipoEmpreendimento',
        'totalunidades': 'TotalUnidades',
    }
    df = df.rename(columns={c: mapa[c.lower()] for c in df.columns if c.lower() in mapa})
    # a síntese já traz o nº de quartos numérico em 'tipologia'; sem isso as linhas
    # de mercado ficariam sem tipologia_tratada e fora de qualquer corte por quartos
    if 'tipologia' in df.columns:
        df['tipologia_tratada'] = pd.to_numeric(df['tipologia'], errors='coerce')
    return df


# colunas de data que trafegam como texto (vêm assim do cadastro e são exibidas na ficha)
COLS_DATA_TEXTO = ['DataProtocoloProjeto', 'DataProtocoloProjetoOutros',
                   'DataAprovacao', 'DataRemembramentoDesmembramento', 'datainobr', 'datahabt']
# marcadores de vazio das várias origens (SQL Server, Excel, síntese)
VAZIOS = {'', '-', 'nan', 'NaN', 'None', 'NaT'}
# colunas em que o cadastro grava literalmente 0 no lugar de "não informado".
# Fora desta lista o zero é dado (tipologia 0 = comercial, por exemplo).
COLS_ZERO_VAZIO = ['Observacao', 'DadosExtras', 'descPavimentos', 'Logradouro',
                   'Complemento', 'LinkDoProjeto', 'macrozona', 'IPTU',
                   'IdProtocoloProjeto', 'IdProtocoloProjetoOutros',
                   'Consorcio.Id', 'consideracao_OF']


def aplicar_ajustes_finais(df):
    df = df.copy()
    for col in ['data', 'dtlançamento']:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')
            df[col] = df[col].apply(lambda x: x.replace(day=1) if pd.notnull(x) else x)
    # datas-texto num formato único (ISO, sem hora): a síntese trazia '2024-12-18 00:00:00'
    for col in COLS_DATA_TEXTO:
        if col in df.columns:
            d = pd.to_datetime(df[col], errors='coerce')
            df[col] = d.dt.strftime('%Y-%m-%d').where(d.notna(), None)
    # macrozona: SQL Server dá '1005' e a síntese '1005.0' — sem isso o mesmo
    # território vira dois grupos num GROUP BY
    if 'macrozona' in df.columns:
        df['macrozona'] = (df['macrozona'].astype(str).str.strip()
                           .str.replace(r'\.0$', '', regex=True))
    # nulos de verdade em vez das strings 'nan'/'0' que quebravam IS NULL no Postgres
    tipadas = set(TIPOS_PG)  # numéricas e datas já têm tipo próprio no Postgres
    for col in df.columns:
        if col in tipadas:
            continue
        s = df[col]
        marcadores = VAZIOS | ({'0', '0.0', '0,0'} if col in COLS_ZERO_VAZIO else set())
        vazio = s.isna() | s.astype(str).str.strip().isin(marcadores)
        df[col] = s.where(~vazio, None)
    if 'dtlançamento' in df.columns and 'data' in df.columns:
        df['lancamento'] = np.where(df['dtlançamento'] == df['data'], 'sim', 'não')
    return df


SEM_PREV_TABLE = 'empreendimentos-sem-previsão-lançamento'
SQL_SEM_PREVISAO = """
SELECT
    ec.Id                 AS id,
    ec.Empreendimento     AS empreendimento,
    COALESCE(NULLIF(LTRIM(RTRIM(i.Nome)), ''), co.Nome) AS incorporadora,
    b.Nome                AS bairro,
    c.Nome                AS cidade,
    c.Uf                  AS uf,
    ec.TipoEmpreendimento AS tipo,
    ec.MacroRegiao        AS macrozona,
    ec.Latitude           AS lat,
    ec.Longitude          AS lng,
    ec.Logradouro         AS logradouro,
    ec.Complemento        AS complemento,
    ec.AreaTerreno        AS area_terreno,
    ec.TotalUnidades      AS total_unidades,
    ec.Observacao         AS observacao,
    CAST(NULL AS bit)     AS projeto_protocolado,
    CAST(NULL AS bit)     AS projeto_aprovado,
    ec.IdProtocoloProjeto AS id_protocolo,
    ec.DataProtocoloProjeto AS data_protocolo,
    ec.DataProtocoloProjetoOutros AS data_protocolo_outros,
    ec.DataAprovacao      AS data_aprovacao,
    ec.DataRemembramentoDesmembramento AS data_remembramento,
    ec.LinkDoProjeto      AS link_projeto,
    ec.FonteEmpreendimento AS fonte_empreendimento
FROM dbo.EmpreendimentoCadastro ec
JOIN dbo.Cidade c        ON c.Id = ec.CidadeId
LEFT JOIN dbo.Bairro b   ON b.Id = ec.BairroId
LEFT JOIN dbo.Incorporadora i ON i.Id = ec.IncorporadoraId
LEFT JOIN dbo.Consorcio co    ON co.Id = ec.ConsorcioId
WHERE ec.Inativo = 0 AND c.Regional = 'GO'
  AND ec.DataLancamento IS NULL AND ec.DataPrevisaoLancamento IS NULL
"""


def gravar_sem_previsao(pg):
    """Terrenos monitorados sem data de lançamento/previsão -> tabela própria no Neon.

    O dashboard consome via /api/sql (checkbox "sem previsão" no mapa)."""
    cn = sqlserver_connect()
    df = pd.read_sql(SQL_SEM_PREVISAO, cn)
    cn.close()
    df['link_portal'] = df['id'].apply(lambda x: f'https://inteligencia.ebm.com.br/Empreendimento/Alterar/{int(x)}')
    tipos = {'id': 'bigint', 'lat': 'double precision', 'lng': 'double precision',
             'area_terreno': 'double precision', 'total_unidades': 'double precision'}
    copy_dataframe(pg, df, SEM_PREV_TABLE, tipos)
    set_meta(pg, 'sem_previsao_linhas', len(df))
    print(f'  {SEM_PREV_TABLE}: {len(df)} empreendimentos gravados no Neon')
    return df


def ler_meta(pg, chave):
    try:
        cur = pg.cursor()
        cur.execute('SELECT valor FROM of_meta WHERE chave = %s', (chave,))
        row = cur.fetchone()
    except Exception:
        pg.rollback()
        return None
    return str(row[0]) if row else None


def checar_variacao(pg, n_emps, parametros):
    """Barra a publicação silenciosa de uma base muito menor que a anterior.

    Uma execução com janela de lançamento errada derruba dezenas de empreendimentos
    sem erro nenhum — o dashboard só some com metade dos projetos.

    Estreitar a janela de propósito também cai aqui, e cai certo: o pipeline não tem
    como saber se a queda foi intencional. Por isso a mensagem mostra os parâmetros
    das duas execuções — se a janela mudou, a queda é esperada e o operador libera
    com OF_IGNORAR_QUEDA=1 (campo "ignorar_queda" no formulário do workflow).
    """
    bruto = ler_meta(pg, 'projecao_empreendimentos')
    anterior = int(bruto) if bruto and bruto.strip().isdigit() else 0
    if not anterior or n_emps >= anterior * 0.9:
        return
    queda = 100 - round(n_emps * 100 / anterior)
    antes = ler_meta(pg, 'projecao_parametros') or '(não registrados)'
    if os.environ.get('OF_IGNORAR_QUEDA') == '1':
        print(f'  AVISO: {anterior} -> {n_emps} empreendimentos (-{queda}%), ignorado por OF_IGNORAR_QUEDA=1')
        return
    raise SystemExit(
        f'Abortado: {n_emps} empreendimentos na janela contra {anterior} da execução anterior (-{queda}%).\n'
        f'  parâmetros desta execução: {parametros}\n'
        f'  parâmetros da anterior:    {antes}\n'
        '  Se a janela mudou, a queda é esperada: rode de novo com ignorar_queda = sim\n'
        '  (ou OF_IGNORAR_QUEDA=1). Se a janela é a mesma, algo mudou na fonte — investigue\n'
        '  antes de publicar.')


def ler_empreendimentos_sql():
    print('Lendo empreendimentos do SQL Server...')
    conn = sqlserver_connect()
    cur = conn.cursor()
    cur.execute(SQL_EMPREENDIMENTOS)
    cols = [d[0] for d in cur.description]
    df = pd.DataFrame.from_records(cur.fetchall(), columns=cols)
    conn.close()
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].apply(lambda v: float(v) if hasattr(v, 'as_tuple') else v)
    print(f'  {len(df)} tipologias / {df["Id_empreendimento"].nunique()} empreendimentos')
    return df


def ler_coordenadas_sql():
    """Vértices da seção Coordenadas do Portal -> DataFrame id/lat/lng.

    A tabela não tem nome garantido (schema evolui com o portal): descobre via
    INFORMATION_SCHEMA a tabela com Latitude+Longitude+chave do cadastro. Falha
    (tabela ausente, permissão, layout novo) NÃO derruba o pipeline — o dashboard
    cai no snapshot manual data/portal_coordenadas.js e o log avisa.
    """
    try:
        conn = sqlserver_connect()
        cur = conn.cursor()
        cur.execute("""
            SELECT t.name,
                   MAX(CASE WHEN c.name LIKE 'EmpreendimentoCadastro%Id' OR c.name LIKE 'EmpreendimentoCadastroId' THEN c.name END) AS fk
                   , MAX(CASE WHEN c.name = 'Latitude' THEN 1 ELSE 0 END) AS tem_lat
                   , MAX(CASE WHEN c.name = 'Longitude' THEN 1 ELSE 0 END) AS tem_lng
                   , MAX(CASE WHEN c.name LIKE '%Ordem%' THEN 1 ELSE 0 END) AS tem_ordem
            FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
            WHERE t.name LIKE '%Coordenada%'
            GROUP BY t.name""")
        candidatos = cur.fetchall()
        escolhida = None
        for tabela, fk, tem_lat, tem_lng, tem_ordem in candidatos:
            if fk and tem_lat and tem_lng:
                escolhida = (tabela, fk, tem_ordem)
                break
        if not escolhida:
            print('  AVISO: tabela de coordenadas não encontrada no SQL Server — snapshot manual segue em pé')
            conn.close()
            return pd.DataFrame(columns=['id_empreendimento', 'latitude', 'longitude'])
        tabela, fk, tem_ordem = escolhida
        ordem = 'Ordem, Id' if tem_ordem else 'Id'
        cur.execute(f'SELECT c.{fk} AS Id_empreendimento, '
                    f'c.Latitude AS latitude, c.Longitude AS longitude, '
                    f'ec.Empreendimento AS empreendimento, b.Nome AS bairro '
                    f'FROM dbo.{tabela} c '
                    f'LEFT JOIN dbo.EmpreendimentoCadastro ec ON ec.Id = c.{fk} '
                    f'LEFT JOIN dbo.Bairro b ON b.Id = ec.BairroId '
                    f'ORDER BY c.{fk}, {ordem}')
        cols = [d[0] for d in cur.description]
        df = pd.DataFrame.from_records(cur.fetchall(), columns=cols)
        conn.close()
        for c in df.columns:
            if df[c].dtype == object:
                df[c] = df[c].apply(lambda v: float(v) if hasattr(v, 'as_tuple') else v)
        df = df.dropna(subset=['latitude', 'longitude'])
        n_emp = df['Id_empreendimento'].nunique() if len(df) else 0
        print(f'  coordenadas (dbo.{tabela}): {len(df)} vértices / {n_emp} empreendimentos')
        return df.rename(columns={'Id_empreendimento': 'id_empreendimento'})
    except Exception as e:
        print(f'  AVISO: coordenadas do SQL indisponíveis ({str(e)[:120]}) — snapshot manual segue em pé')
        return pd.DataFrame(columns=['id_empreendimento', 'latitude', 'longitude'])


def ler_sintese_neon(conn):
    print('Lendo síntese consolidada do Neon...')
    cur = conn.cursor()
    cur.execute('SELECT * FROM sintese_consolidada')
    cols = [d[0] for d in cur.description]
    df = pd.DataFrame.from_records(cur.fetchall(), columns=cols)
    print(f'  {len(df)} linhas')
    return df


def atualizar_cache_buster():
    """Renova o ?v= do index.html com o carimbo desta execução.

    Sem isso o navegador continua servindo o data/dados_of.js anterior: o arquivo
    muda, a URL não, e o dashboard fica mostrando a base da execução passada.
    """
    caminho = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'index.html')
    with open(caminho, encoding='utf-8') as fh:
        html = fh.read()
    token = datetime.now().strftime('%Y%m%d-%H%M')
    novo = re.sub(r'\?v=[A-Za-z0-9.\-]+', '?v=' + token, html)
    if novo != html:
        with open(caminho, 'w', encoding='utf-8', newline='') as fh:
            fh.write(novo)
        print(f'  cache-buster do index.html: ?v={token}')


def parametros_anteriores(pg):
    """O botão atualiza a base sem trocar silenciosamente o recorte da projeção."""
    with pg.cursor() as cur:
        cur.execute("SELECT valor FROM of_meta WHERE chave = %s", ('projecao_parametros',))
        row = cur.fetchone()
    match = re.fullmatch(r'base (\d{2}/\d{4}) \| janela [^|]+ \| fator (\d+(?:\.\d+)?)', str(row[0]) if row else '')
    if not match:
        raise ValueError('Parâmetros anteriores ausentes ou inválidos. Rode o pipeline manualmente com data base e fator explícitos.')
    return match[1], float(match[2])


def main():
    load_env()
    data_base = os.environ.get('OF_DATA_BASE', '01/2026')
    fator_ajuste = float(os.environ.get('FATOR_AJUSTE', '1.0').replace(',', '.'))
    pg = None
    if os.environ.get('OF_MANTER_PARAMETROS') == '1':
        pg = neon_connect()
        data_base, fator_ajuste = parametros_anteriores(pg)
    dt_ini = mes_ano(data_base)
    dt_fim = dt_ini + DateOffset(months=MESES_CURVA)
    # janela fecha no ÚLTIMO dia do mês final: um lançamento em 20/09/2027 pertence a
    # setembro e não pode cair fora por causa do dia
    dt_fim_mes = dt_fim + DateOffset(months=1) - DateOffset(days=1)
    lancto_ini, lancto_fim = dt_ini.strftime('%m/%Y'), dt_fim.strftime('%m/%Y')
    parametros = f'base {lancto_ini} | janela {lancto_ini}-{lancto_fim} | fator {fator_ajuste}'
    print(f'Parâmetros: data base {lancto_ini} + {MESES_CURVA} meses '
          f'-> janela e projeção até {lancto_fim} | fator {fator_ajuste}')

    pg = pg or neon_connect()
    df_s = ler_sintese_neon(pg)
    df_of = ler_empreendimentos_sql()
    df_sem_prev = gravar_sem_previsao(pg)
    df_coord = ler_coordenadas_sql()

    # -------- etapa 1: curvas por cluster (síntese) --------
    df_s['datalancamento'] = pd.to_datetime(df_s['datalancamento'], errors='coerce')
    df_s['data'] = pd.to_datetime(df_s['data'], errors='coerce')
    for c in ['totalunidades', 'privativa', 'unidadesvendidasmes', 'unidadesdistratadasmes',
              'unidadesdisponiveis', 'tipologia', 'latitude', 'longitude']:
        df_s[c] = pd.to_numeric(df_s[c], errors='coerce')
    df_s['cluster'] = [definir_cluster(t, q) for t, q in zip(df_s['tipoempreendimento'], df_s['tipologia'])]
    df_s['venda_liquida'] = df_s['unidadesvendidasmes'].fillna(0) - df_s['unidadesdistratadasmes'].fillna(0)
    # incorporadora faz parte do grão do produto; NULL vira '' para o merge da curva
    # não descartar a linha (a limpeza final devolve '' a None na master)
    df_s['incorporadora'] = df_s['incorporadora'].fillna('')

    df_prod_s = df_s.drop_duplicates(subset=ID_COLS_SINTESE).copy()
    curvas, curva_padrao, log_curvas = curvas_de_venda(df_s, dt_ini, fator_ajuste)
    print('  curvas por etapa de vida (acumulado):')
    for linha in log_curvas:
        print(linha)
    validar_vso(df_s, dt_ini, df_prod_s.assign(
        datalancamento=pd.to_datetime(df_prod_s['datalancamento'], errors='coerce')))

    # -------- etapa 2: projeção OF --------
    df_of = df_of.rename(columns={
        'EmpreendimentoTipologia.Id': 'id_tipologia',
        'Cidade.Nome': 'cidade', 'Bairro.Nome': 'bairro',
        'Empreendimento': 'empreendimento', 'dtlancamento': 'DataLancamento',
        'Incorporadora.Nome': 'incorporadora', 'MacroRegiao': 'macrozona',
        'DescricaoDosPavimentos': 'descPavimentos',
        'Id_empreendimento': 'id_empreendimento',
    })
    # incorporadora vazia cai no NOME do consórcio (ex.: PARQUE AMÉRICA TRANCOSO
    # não tem incorporadora no cadastro, é o consórcio EBM/TROPICAL). Vale para o
    # filtro, tabelas e ficha; incorpOUconsorcio registra o valor final na master.
    vazio = df_of['incorporadora'].isna() | (df_of['incorporadora'].astype(str).str.strip() == '')
    df_of['incorporadora'] = df_of['incorporadora'].where(~vazio, df_of['Consorcio.Nome'])
    df_of['incorpOUconsorcio'] = df_of['incorporadora']
    df_of['dtlançamento'] = pd.to_datetime(
        df_of['DataLancamento'].fillna(df_of['DataPrevisaoLancamento']), errors='coerce')
    df_of = df_of[(df_of['dtlançamento'] >= dt_ini) & (df_of['dtlançamento'] <= dt_fim_mes)].copy()
    n_emps = df_of['id_empreendimento'].nunique()
    print(f'  janela OF: {len(df_of)} tipologias / {n_emps} empreendimentos')
    checar_variacao(pg, n_emps, parametros)

    # tipologia sem contagem de unidades não projeta nada (antes vinha zerada pelo fillna global)
    df_of['Unids_tipologia'] = pd.to_numeric(df_of['Unids_tipologia'], errors='coerce').fillna(0)
    # PerfilTipologia NULL (cadastro incompleto) cai pro NumeroQuartos; 0 fica só p/ comercial de verdade
    quartos = pd.to_numeric(df_of['NumeroQuartos'], errors='coerce').clip(upper=4)
    df_of['tipologia_tratada'] = (df_of['tipologia'].astype(str).str.upper().str.strip()
                                  .map(MAPA_TIPOLOGIA).fillna(quartos).fillna(0))
    df_of['cluster'] = [definir_cluster(t, q) for t, q in zip(df_of['TipoEmpreendimento'], df_of['tipologia_tratada'])]
    # curva do cluster; quem não se encaixa em cluster APART (ou o cluster não tem
    # histórico) segue a curva global do mercado — decisão validada com o usuário
    df_meta = df_of.copy()
    for c in CURVA_COLS:
        df_meta[c] = df_meta['cluster'].map(lambda cl, c=c: curvas.get(cl, curva_padrao)[c])

    proj_rows = []
    for _, row in df_meta.iterrows():
        v_acum = 0
        id_emp = str(row['id_empreendimento'])
        id_emp_str = str(int(float(id_emp))) if id_emp.replace('.', '').isdigit() else ''
        link = f'https://inteligencia.ebm.com.br/Empreendimento/Alterar/{id_emp_str}' if id_emp_str else ''
        # a série vai até o fim da própria vida de 18M OU até o fim da projeção da
        # síntese, o que for mais longe. Sem o prolongamento, um produto lançado na
        # data base terminava em base+17 e o estoque que sobrou dele SUMIA do total
        # um mês antes do horizonte — a curva única perdia unidades sem venda nenhuma.
        lanc = row['dtlançamento']
        n_meses = max(MESES_CURVA, (dt_fim.year - lanc.year) * 12 + (dt_fim.month - lanc.month) + 1)
        for m in range(1, n_meses + 1):
            # depois do 18º mês de vida a curva acabou: v_m = 0 e o estoque fica de pé
            v_m = int(round(row['Unids_tipologia'] * row.get(f'%{m}M', 0))) if m <= MESES_CURVA else 0
            v_acum += v_m
            proj_rows.append({**{c: row.get(c) for c in df_of.columns},
                              'data': lanc + DateOffset(months=m - 1),
                              'unidadesvendidasmes': v_m,
                              'unidadesdisponiveis': row['Unids_tipologia'] - v_acum,
                              'unidadesdistratadasmes': 0, 'LinkPortal': link})
    df_final_of = pd.DataFrame(proj_rows)
    df_final_of['consideracao_OF'] = df_final_of.get('EmpreendimentoTipologia.ConsideracaoOF', np.nan)
    for col in COLUNAS_ORDEM_FINAL_OF:
        if col not in df_final_of.columns:
            df_final_of[col] = np.nan
    df_final_of = df_final_of[COLUNAS_ORDEM_FINAL_OF]

    # -------- etapa 3: extensão da síntese --------
    proj_s = []
    for _, prod in df_prod_s.iterrows():
        # cluster desconhecido segue a curva do mercado, igual à projeção OF
        curva = curvas.get(prod['cluster'], curva_padrao)
        # o grão inclui a incorporadora: em consórcio cada membro tem a própria linha
        # e é estendido separadamente (o estoque oficial soma todas)
        hist = df_s[(df_s['empreendimento'] == prod['empreendimento']) &
                    (df_s['tipologia'] == prod['tipologia']) &
                    (df_s['privativa'] == prod['privativa']) &
                    (df_s['incorporadora'] == prod['incorporadora'])].sort_values('data')
        if hist.empty:
            continue
        ultimo = hist.iloc[-1]
        # só estende produto VIVO no snapshot da data base. Produto cuja última linha
        # é anterior saiu do acompanhamento (esgotou/suspendeu); arrastar o estoque
        # dele para frente ressuscitava "estoque zumbi" e inflava a data base em
        # +4.682 un (17.789 contra as 13.107 da planilha).
        if ultimo['data'] != pd.Timestamp(dt_ini):
            continue
        lancto = pd.to_datetime(prod['datalancamento'], errors='coerce')
        # sem data de lançamento não há curva de vida a aplicar — mas o estoque do
        # produto existe e fica DE PÉ (v_m = 0) até o horizonte. Pular o produto
        # fazia o estoque dele evaporar da curva única depois da data base.
        data_cur = ultimo['data']
        # o produto pode ter MAIS DE UMA linha no mês do snapshot (a origem repete a
        # linha quando o preço muda). O estoque a projetar é a SOMA delas — carregar
        # só a última linha vazava a diferença (295 un) e, quando a última vinha
        # zerada, o produto inteiro sumia da projeção (71 un).
        est_cur = hist[hist['data'] == ultimo['data']]['unidadesdisponiveis'].sum()
        while pd.notnull(data_cur) and data_cur < dt_fim and est_cur > 0:
            data_cur += DateOffset(months=1)
            if pd.isnull(lancto):
                vida = 0
            else:
                vida = (data_cur.year - lancto.year) * 12 + (data_cur.month - lancto.month) + 1
            v_m = int(round(prod['totalunidades'] * curva[f'%{int(vida)}M'])) \
                if 1 <= vida <= MESES_CURVA else 0
            v_m = min(v_m, max(0, est_cur))
            est_cur -= v_m
            nova = ultimo.to_dict()
            nova.update({'data': data_cur, 'unidadesvendidasmes': v_m,
                         'unidadesdisponiveis': est_cur, 'unidadesdistratadasmes': 0})
            proj_s.append(nova)
    df_final_s = pd.concat([df_s, pd.DataFrame(proj_s)], ignore_index=True)
    print(f'  síntese estendida: {len(df_final_s)} linhas (+{len(proj_s)} projetadas)')

    # -------- união master --------
    df_s_master = ajustar_contexto_sintese(df_final_s.copy())
    df_master = pd.concat([df_final_of, df_s_master], ignore_index=True, sort=False)
    for col in COLUNAS_ORDEM_FINAL_OF:
        if col not in df_master.columns:
            df_master[col] = np.nan
    # única passada de limpeza: normaliza nulos, datas-texto e macrozona
    df_master = aplicar_ajustes_finais(df_master[COLUNAS_ORDEM_FINAL_OF])
    print(f'Master unificada: {len(df_master)} linhas '
          f'({df_master["id_tipologia"].notna().sum()} OF + {df_master["id_tipologia"].isna().sum()} síntese)')

    # -------- grava no Neon --------
    print('Gravando projecao_of no Neon...')
    df_pg = df_master.copy()
    for c in ['data', 'dtlançamento']:
        df_pg[c] = pd.to_datetime(df_pg[c], errors='coerce').dt.date
    copy_dataframe(pg, df_pg, 'projecao_of', TIPOS_PG)
    set_meta(pg, 'projecao_linhas', len(df_pg))
    set_meta(pg, 'projecao_empreendimentos', n_emps)  # base da guarda de sanidade
    set_meta(pg, 'projecao_parametros', parametros)
    pg.close()

    # -------- gera dados do dashboard --------
    print('Gerando dados do dashboard...')
    # os sem previsão entram no dados_of.js num array separado (semPrevisao): aparecem
    # nos filtros, no mapa e na tabela própria SEM tocar os indicadores da projeção
    preprocess.gerar_de_dataframe(df_master, fonte='projecao_of (Neon)',
                                  sem_previsao=df_sem_prev.to_dict('records'),
                                  coordenadas=df_coord.to_dict('records') if len(df_coord) else None)
    atualizar_cache_buster()
    print('Pipeline concluído.')


if __name__ == '__main__':
    main()
