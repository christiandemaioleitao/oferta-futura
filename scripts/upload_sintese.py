# -*- coding: utf-8 -*-
"""
Sobe a planilha da SÍNTESE CONSOLIDADA para o Neon (tabela sintese_consolidada).

Uso:
  python scripts/upload_sintese.py "caminho/para/sintese_consolidada.xlsx"

Requer NEON_DATABASE_URL no ambiente ou em um arquivo .env na raiz do repo.
A tabela é recriada a cada upload (substituição completa).
"""
import sys

import pandas as pd

from of_common import load_env, neon_connect, copy_dataframe, set_meta

COLUNAS = [
    'cidade', 'bairro', 'incorporadora', 'tipoempreendimento', 'empreendimento',
    'datainobr', 'datahabt', 'regional', 'consorcio', 'totalunidades', 'privativa',
    'unidadesvendidasmes', 'unidadesdistratadasmes', 'unidadesdisponiveis',
    'percevolucaoobra', 'tipologia', 'precounidade', 'datalancamento', 'data',
    'macroregiao', 'latitude', 'longitude', 'lancou',
]

TIPOS = {
    'datainobr': 'date', 'datahabt': 'date', 'datalancamento': 'date', 'data': 'date',
    'totalunidades': 'double precision', 'privativa': 'double precision',
    'unidadesvendidasmes': 'double precision', 'unidadesdistratadasmes': 'double precision',
    'unidadesdisponiveis': 'double precision', 'percevolucaoobra': 'double precision',
    'tipologia': 'double precision', 'precounidade': 'double precision',
    'macroregiao': 'double precision', 'latitude': 'double precision',
    'longitude': 'double precision',
}


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Uso: python scripts/upload_sintese.py <sintese_consolidada.xlsx|csv>')
    load_env()
    path = sys.argv[1]
    print('Lendo', path)
    if path.lower().endswith(('.csv', '.csv.gz')):
        df = pd.read_csv(path, sep=None, engine='python', encoding='utf-8-sig')
    else:
        df = pd.read_excel(path)
    df.columns = [str(c).strip().lower() for c in df.columns]
    faltando = [c for c in COLUNAS if c not in df.columns]
    if faltando:
        raise SystemExit(f'Colunas ausentes na planilha: {faltando}')
    df = df[COLUNAS].copy()

    for c in ['latitude', 'longitude']:
        df[c] = pd.to_numeric(df[c].astype(str).str.replace(',', '.'), errors='coerce')
    for c, t in TIPOS.items():
        if t == 'date':
            df[c] = pd.to_datetime(df[c], errors='coerce').dt.date
        else:
            df[c] = pd.to_numeric(df[c], errors='coerce')

    conn = neon_connect()
    print(f'Enviando {len(df)} linhas para sintese_consolidada...')
    copy_dataframe(conn, df, 'sintese_consolidada', TIPOS)
    set_meta(conn, 'sintese_linhas', len(df))
    set_meta(conn, 'sintese_arquivo', path.replace('\\', '/').split('/')[-1])
    cur = conn.cursor()
    cur.execute('SELECT count(*), min(data), max(data) FROM sintese_consolidada')
    n, dmin, dmax = cur.fetchone()
    conn.close()
    print(f'OK: {n} linhas no Neon | data {dmin} -> {dmax}')


if __name__ == '__main__':
    main()
