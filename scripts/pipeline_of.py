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

Parâmetros (variáveis de ambiente, com os padrões do último processamento):
  OF_LANCTO_INI   mm/aaaa  início da janela de lançamentos OF   (padrão 01/2026)
  OF_LANCTO_FIM   mm/aaaa  fim da janela de lançamentos OF      (padrão 12/2027)
  DATA_FIM_PROJ   mm/aaaa  data final da projeção da síntese    (padrão 06/2027)
  FATOR_AJUSTE    float    fator multiplicador da curva          (padrão 1.0)
"""
import os
import subprocess
import sys
import tempfile
from datetime import datetime

import numpy as np
import pandas as pd
from pandas.tseries.offsets import DateOffset

from of_common import BASE, load_env, neon_connect, sqlserver_connect, copy_dataframe, set_meta

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


def limpar_zeros_texto(df):
    df = df.copy()
    cols_texto = ['Observacao', 'DadosExtras', 'descPavimentos', 'Logradouro',
                  'Complemento', 'LinkDoProjeto', 'macrozona']
    for col in cols_texto:
        if col in df.columns:
            df[col] = df[col].astype(str).replace(['0', '0.0', 'nan', 'None', 'NaN', 'nan.0'], '')
    return df


def ajustar_contexto_sintese(df):
    mapa = {
        'latitude': 'Latitude', 'longitude': 'Longitude',
        'datalancamento': 'dtlançamento', 'macroregiao': 'macrozona',
        'macrozona': 'macrozona', 'privativa': 'AreaPrivativa',
        'unidades_tipologia': 'Unids_tipologia', 'tipoempreendimento': 'TipoEmpreendimento',
        'descpavimentos': 'descPavimentos',
    }
    return df.rename(columns={c: mapa[c.lower()] for c in df.columns if c.lower() in mapa})


def aplicar_ajustes_finais(df):
    df = df.copy()
    for col in ['data', 'dtlançamento']:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')
            df[col] = df[col].apply(lambda x: x.replace(day=1) if pd.notnull(x) else x)
    cols_zero_hifen = [
        'DataProtocoloProjetoOutros', 'IdProtocoloProjetoOutros', 'ProjetoProtocoladoOutros',
        'MCMV', 'DataAprovacao', 'FonteDataLancamento', 'FonteTipologia',
        'FonteDataPrevisaoLancamento', 'tipologia', 'Consorcio.Id', 'consideracao_OF',
        'incorporadora',
    ]
    for col in cols_zero_hifen:
        if col in df.columns:
            df[col] = df[col].astype(str).replace(['0', '0.0', '0,0'], '-')
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


def main():
    load_env()
    lancto_ini = os.environ.get('OF_LANCTO_INI', '01/2026')
    lancto_fim = os.environ.get('OF_LANCTO_FIM', '12/2027')
    data_fim_proj = os.environ.get('DATA_FIM_PROJ', '06/2027')
    fator_ajuste = float(os.environ.get('FATOR_AJUSTE', '1.0').replace(',', '.'))
    print(f'Parâmetros: OF {lancto_ini}–{lancto_fim} | projeção síntese até {data_fim_proj} | fator {fator_ajuste}')

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
        df_prod_s = df_prod_s.merge(v, on=id_cols, how='left').fillna(0)

    resumo = df_prod_s.groupby('cluster')[['totalunidades', 'vendas3M', 'vendas6M', 'vendas12M', 'vendas18M']].sum().reset_index()
    resumo['totalunidades'] = resumo['totalunidades'].replace(0, np.nan)
    for m in range(1, 19):
        if m <= 3: val = (resumo['vendas3M'] / resumo['totalunidades']) / 3
        elif m <= 6: val = ((resumo['vendas6M'] - resumo['vendas3M']) / resumo['totalunidades']) / 3
        elif m <= 12: val = ((resumo['vendas12M'] - resumo['vendas6M']) / resumo['totalunidades']) / 6
        else: val = ((resumo['vendas18M'] - resumo['vendas12M']) / resumo['totalunidades']) / 6
        resumo[f'%{m}M'] = val.fillna(0) * fator_ajuste

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
    dt_ini = datetime.strptime(lancto_ini, '%m/%Y')
    dt_fim = datetime.strptime(lancto_fim, '%m/%Y')
    df_of = df_of[(df_of['dtlançamento'] >= dt_ini) & (df_of['dtlançamento'] <= dt_fim)].copy()
    print(f'  janela OF: {len(df_of)} tipologias / {df_of["id_empreendimento"].nunique()} empreendimentos')

    # PerfilTipologia NULL (cadastro incompleto) cai pro NumeroQuartos; 0 fica só p/ comercial de verdade
    quartos = pd.to_numeric(df_of['NumeroQuartos'], errors='coerce').clip(upper=4)
    df_of['tipologia_tratada'] = (df_of['tipologia'].astype(str).str.upper().str.strip()
                                  .map(MAPA_TIPOLOGIA).fillna(quartos).fillna(0))
    df_of['cluster'] = [definir_cluster(t, q) for t, q in zip(df_of['TipoEmpreendimento'], df_of['tipologia_tratada'])]
    df_meta = df_of.merge(resumo[['cluster'] + [f'%{i}M' for i in range(1, 19)]], on='cluster', how='left').fillna(0)

    proj_rows = []
    for _, row in df_meta.iterrows():
        v_acum = 0
        id_emp = str(row['id_empreendimento'])
        id_emp_str = str(int(float(id_emp))) if id_emp.replace('.', '').isdigit() else ''
        link = f'https://inteligencia.ebm.com.br/Empreendimento/Alterar/{id_emp_str}' if id_emp_str else ''
        for m in range(1, 19):
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
    dt_fim_p = datetime.strptime(data_fim_proj, '%m/%Y')
    proj_s = []
    for _, prod in df_prod_s.iterrows():
        curva = resumo[resumo['cluster'] == prod['cluster']]
        hist = df_s[(df_s['empreendimento'] == prod['empreendimento']) &
                    (df_s['tipologia'] == prod['tipologia']) &
                    (df_s['privativa'] == prod['privativa'])].sort_values('data')
        if hist.empty:
            continue
        ultimo = hist.iloc[-1]
        data_cur, est_cur = ultimo['data'], ultimo['unidadesdisponiveis']
        while pd.notnull(data_cur) and data_cur < dt_fim_p and est_cur > 0:
            data_cur += DateOffset(months=1)
            if pd.isnull(prod['datalancamento']):
                break
            vida = (data_cur.year - prod['datalancamento'].year) * 12 + (data_cur.month - prod['datalancamento'].month) + 1
            v_m = int(round(prod['totalunidades'] * pd.to_numeric(curva[f'%{int(vida)}M'].values[0], errors='coerce'))) \
                if (1 <= vida <= 18 and not curva.empty) else 0
            v_m = min(v_m, max(0, est_cur))
            est_cur -= v_m
            nova = ultimo.to_dict()
            nova.update({'data': data_cur, 'unidadesvendidasmes': v_m,
                         'unidadesdisponiveis': est_cur, 'unidadesdistratadasmes': 0})
            proj_s.append(nova)
    df_final_s = pd.concat([df_s, pd.DataFrame(proj_s)], ignore_index=True)
    print(f'  síntese estendida: {len(df_final_s)} linhas (+{len(proj_s)} projetadas)')

    # -------- união master --------
    df_final_of = limpar_zeros_texto(df_final_of)
    df_final_s = limpar_zeros_texto(df_final_s)
    df_s_master = ajustar_contexto_sintese(df_final_s.copy())
    df_master = pd.concat([df_final_of, df_s_master], ignore_index=True, sort=False)
    for col in COLUNAS_ORDEM_FINAL_OF:
        if col not in df_master.columns:
            df_master[col] = np.nan
    df_master = limpar_zeros_texto(df_master[COLUNAS_ORDEM_FINAL_OF])
    df_master = aplicar_ajustes_finais(df_master)
    print(f'Master unificada: {len(df_master)} linhas '
          f'({df_master["id_tipologia"].notna().sum()} OF + {df_master["id_tipologia"].isna().sum()} síntese)')

    # -------- grava no Neon --------
    print('Gravando projecao_of no Neon...')
    df_pg = df_master.copy()
    for c in ['data', 'dtlançamento']:
        df_pg[c] = pd.to_datetime(df_pg[c], errors='coerce').dt.date
    copy_dataframe(pg, df_pg, 'projecao_of', TIPOS_PG)
    set_meta(pg, 'projecao_linhas', len(df_pg))
    set_meta(pg, 'projecao_parametros', f'OF {lancto_ini}-{lancto_fim} | proj {data_fim_proj} | fator {fator_ajuste}')
    pg.close()

    # -------- gera dados do dashboard --------
    tmp_xlsx = os.path.join(tempfile.gettempdir(), 'Projecao_OF_pipeline.xlsx')
    print('Gerando Excel intermediário e dados do dashboard...')
    df_x = df_master.copy()
    df_x.to_excel(tmp_xlsx, index=False, sheet_name='Sheet1')
    kmz = os.path.join(BASE, 'fontes', 'Oferta Futura - 2026.kmz')
    r = subprocess.run([sys.executable, os.path.join(BASE, 'scripts', 'preprocess.py'), tmp_xlsx, kmz],
                       capture_output=True, text=True)
    print(r.stdout)
    if r.returncode != 0:
        print(r.stderr)
        raise SystemExit('preprocess.py falhou')
    print('Pipeline concluído.')


if __name__ == '__main__':
    main()
