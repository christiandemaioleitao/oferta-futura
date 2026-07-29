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
    'IPTU', 'DataAprovacao', 'FonteEmpreendimento', 'FonteDataLancamento',
    'FonteTipologia', 'FonteDataPrevisaoLancamento', 'Cidade.Uf', 'Cidade.Regional',
    'Consorcio.Id', 'tipologia', 'consideracao_OF', 'cluster', 'LinkPortal',
]

# Query que reproduz o export empreendimentos_OF.xlsx:
# tipologias ativas de cadastros ativos nas cidades da regional GO
# (Goiânia, Aparecida de Goiânia, Senador Canedo). tipologia = PerfilTipologia.
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
    ec.ProjetoProtocolado     AS ProjetoProtocolado,
    ec.ProjetoProtocoladoOutros AS ProjetoProtocoladoOutros,
    ec.ProjetoAprovado        AS ProjetoAprovado,
    ec.IdProtocoloProjeto     AS IdProtocoloProjeto,
    ec.IdProtocoloProjetoOutros AS IdProtocoloProjetoOutros,
    ec.DataProtocoloProjeto   AS DataProtocoloProjeto,
    ec.DataProtocoloProjetoOutros AS DataProtocoloProjetoOutros,
    ec.LinkDoProjeto          AS LinkDoProjeto,
    ec.IPTU                   AS IPTU,
    ec.DataAprovacao          AS DataAprovacao,
    ec.FonteEmpreendimento    AS FonteEmpreendimento,
    ec.FonteDataLancamento    AS FonteDataLancamento,
    t.FonteTipologia          AS FonteTipologia,
    ec.FonteDataPrevisaoLancamento AS FonteDataPrevisaoLancamento,
    c.Uf                      AS [Cidade.Uf],
    c.Regional                AS [Cidade.Regional],
    co.Id                     AS [Consorcio.Id],
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
COLS_VENDAS = ['totalunidades', 'vendas3M', 'vendas6M', 'vendas12M', 'vendas18M']
CURVA_COLS = [f'%{m}M' for m in range(1, MESES_CURVA + 1)]


def mes_ano(txt, rotulo='data base'):
    """'03/2026' -> datetime(2026, 3, 1). Aceita também '2026-03'."""
    txt = str(txt).strip()
    for fmt in ('%m/%Y', '%Y-%m'):
        try:
            return datetime.strptime(txt, fmt)
        except ValueError:
            pass
    raise SystemExit(f'{rotulo} inválida: {txt!r}. Use mm/aaaa, por exemplo 03/2026.')


def taxa_mensal(m, tot, v3, v6, v12, v18):
    """Fração do estoque vendida no mês m de vida, a partir dos acumulados por janela.

    Funciona com escalares ou com Series (a aritmética é vetorizada nos dois casos)."""
    if m <= 3:
        return (v3 / tot) / 3
    if m <= 6:
        return ((v6 - v3) / tot) / 3
    if m <= 12:
        return ((v12 - v6) / tot) / 6
    return ((v18 - v12) / tot) / 6


def curva_do_mercado(df_prod):
    """Curva do mercado inteiro: a mesma conta da curva de cluster, somando toda a base.

    É o que um cluster sem histórico próprio passa a seguir. Antes ele recebia curva
    zerada — vendia nada e o estoque ficava de pé nos 18 meses, o que é uma previsão
    tão arbitrária quanto qualquer outra, só que pessimista ao extremo. A tendência
    média do mercado é o palpite honesto quando não há base de comparação específica.
    """
    s = df_prod[COLS_VENDAS].sum()
    tot = s['totalunidades']
    if not tot or pd.isna(tot):
        return {c: 0.0 for c in CURVA_COLS}
    return {f'%{m}M': float(taxa_mensal(m, tot, s['vendas3M'], s['vendas6M'],
                                        s['vendas12M'], s['vendas18M']))
            for m in range(1, MESES_CURVA + 1)}


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
                   'DataAprovacao', 'datainobr', 'datahabt']
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
    i.Nome                AS incorporadora,
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
    ec.ProjetoProtocolado AS projeto_protocolado,
    ec.ProjetoAprovado    AS projeto_aprovado,
    ec.FonteEmpreendimento AS fonte_empreendimento
FROM dbo.EmpreendimentoCadastro ec
JOIN dbo.Cidade c        ON c.Id = ec.CidadeId
LEFT JOIN dbo.Bairro b   ON b.Id = ec.BairroId
LEFT JOIN dbo.Incorporadora i ON i.Id = ec.IncorporadoraId
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


def main():
    load_env()
    data_base = os.environ.get('OF_DATA_BASE', '01/2026')
    fator_ajuste = float(os.environ.get('FATOR_AJUSTE', '1.0').replace(',', '.'))
    dt_ini = mes_ano(data_base)
    dt_fim = dt_ini + DateOffset(months=MESES_CURVA)
    # janela fecha no ÚLTIMO dia do mês final: um lançamento em 20/09/2027 pertence a
    # setembro e não pode cair fora por causa do dia
    dt_fim_mes = dt_fim + DateOffset(months=1) - DateOffset(days=1)
    lancto_ini, lancto_fim = dt_ini.strftime('%m/%Y'), dt_fim.strftime('%m/%Y')
    parametros = f'base {lancto_ini} | janela {lancto_ini}-{lancto_fim} | fator {fator_ajuste}'
    print(f'Parâmetros: data base {lancto_ini} + {MESES_CURVA} meses '
          f'-> janela e projeção até {lancto_fim} | fator {fator_ajuste}')

    pg = neon_connect()
    df_s = ler_sintese_neon(pg)
    df_of = ler_empreendimentos_sql()
    gravar_sem_previsao(pg)

    # -------- etapa 1: curvas por cluster (síntese) --------
    df_s['datalancamento'] = pd.to_datetime(df_s['datalancamento'], errors='coerce')
    df_s['data'] = pd.to_datetime(df_s['data'], errors='coerce')
    for c in ['totalunidades', 'privativa', 'unidadesvendidasmes', 'unidadesdistratadasmes',
              'unidadesdisponiveis', 'tipologia', 'latitude', 'longitude']:
        df_s[c] = pd.to_numeric(df_s[c], errors='coerce')
    df_s['cluster'] = [definir_cluster(t, q) for t, q in zip(df_s['tipoempreendimento'], df_s['tipologia'])]
    df_s['venda_liquida'] = df_s['unidadesvendidasmes'].fillna(0) - df_s['unidadesdistratadasmes'].fillna(0)

    id_cols = ['empreendimento', 'tipologia', 'privativa']
    df_prod_s = df_s.drop_duplicates(subset=id_cols).copy()
    for p in [3, 6, 12, 18]:
        limite = df_s['datalancamento'] + DateOffset(months=p - 1)
        v = df_s[df_s['data'] <= limite].groupby(id_cols)['venda_liquida'].sum().reset_index()
        v.columns = id_cols + [f'vendas{p}M']
        df_prod_s = df_prod_s.merge(v, on=id_cols, how='left')
        # fillna só na coluna nova: um fillna(0) global viraria datas/bools em zero
        df_prod_s[f'vendas{p}M'] = df_prod_s[f'vendas{p}M'].fillna(0)

    global_curva = curva_do_mercado(df_prod_s)
    resumo = df_prod_s.groupby('cluster')[COLS_VENDAS].sum().reset_index()
    resumo['totalunidades'] = resumo['totalunidades'].replace(0, np.nan)
    for m in range(1, MESES_CURVA + 1):
        col = f'%{m}M'
        val = taxa_mensal(m, resumo['totalunidades'], resumo['vendas3M'],
                          resumo['vendas6M'], resumo['vendas12M'], resumo['vendas18M'])
        # cluster sem estoque histórico segue a tendência média do mercado
        resumo[col] = val.fillna(global_curva[col]) * fator_ajuste
    # curva pronta por cluster; quem não estiver no dicionário cai na global
    curva_padrao = {c: global_curva[c] * fator_ajuste for c in CURVA_COLS}
    curvas = {r['cluster']: {c: r[c] for c in CURVA_COLS} for _, r in resumo.iterrows()}
    sem_hist = [c for c in curvas if all(curvas[c][k] == curva_padrao[k] for k in CURVA_COLS)]
    print(f'  curvas: {len(curvas)} clusters | venda global em 18M: '
          f'{sum(global_curva.values()) * 100:.1f}% do estoque'
          + (f' | sem histórico próprio, seguindo o mercado: {", ".join(sorted(sem_hist))}' if sem_hist else ''))

    # -------- etapa 2: projeção OF --------
    df_of = df_of.rename(columns={
        'EmpreendimentoTipologia.Id': 'id_tipologia',
        'Cidade.Nome': 'cidade', 'Bairro.Nome': 'bairro',
        'Empreendimento': 'empreendimento', 'dtlancamento': 'DataLancamento',
        'Incorporadora.Nome': 'incorporadora', 'MacroRegiao': 'macrozona',
        'DescricaoDosPavimentos': 'descPavimentos',
        'Id_empreendimento': 'id_empreendimento',
    })
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
    df_meta = df_of.merge(resumo[['cluster'] + CURVA_COLS], on='cluster', how='left')
    # cluster que nem existe no histórico também segue a curva global. O fillna é por
    # coluna (dicionário): um fillna global aqui zerava datas de protocolo/aprovação e
    # flags de projeto (a ficha chegou a mostrar "0" como data)
    df_meta[CURVA_COLS] = df_meta[CURVA_COLS].fillna(curva_padrao)

    proj_rows = []
    for _, row in df_meta.iterrows():
        v_acum = 0
        id_emp = str(row['id_empreendimento'])
        id_emp_str = str(int(float(id_emp))) if id_emp.replace('.', '').isdigit() else ''
        link = f'https://inteligencia.ebm.com.br/Empreendimento/Alterar/{id_emp_str}' if id_emp_str else ''
        for m in range(1, MESES_CURVA + 1):
            v_m = int(round(row['Unids_tipologia'] * row.get(f'%{m}M', 0)))
            v_acum += v_m
            proj_rows.append({**{c: row.get(c) for c in df_of.columns},
                              'data': row['dtlançamento'] + DateOffset(months=m - 1),
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
        hist = df_s[(df_s['empreendimento'] == prod['empreendimento']) &
                    (df_s['tipologia'] == prod['tipologia']) &
                    (df_s['privativa'] == prod['privativa'])].sort_values('data')
        if hist.empty:
            continue
        ultimo = hist.iloc[-1]
        lancto = pd.to_datetime(prod['datalancamento'], errors='coerce')
        if pd.isnull(lancto):
            continue  # sem data de lançamento não há curva de vida a aplicar
        data_cur, est_cur = ultimo['data'], ultimo['unidadesdisponiveis']
        while pd.notnull(data_cur) and data_cur < dt_fim and est_cur > 0:
            data_cur += DateOffset(months=1)
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
    preprocess.gerar_de_dataframe(df_master, fonte='projecao_of (Neon)')
    atualizar_cache_buster()
    print('Pipeline concluído.')


if __name__ == '__main__':
    main()
