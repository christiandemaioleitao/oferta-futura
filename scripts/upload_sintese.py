# -*- coding: utf-8 -*-
"""
Sobe a planilha da SÍNTESE CONSOLIDADA para o Neon (tabela sintese_consolidada).

Uso:
  python scripts/upload_sintese.py "caminho/para/sintese_consolidada.xlsx"

Requer NEON_DATABASE_URL no ambiente ou em um arquivo .env na raiz do repo.
A tabela é recriada a cada upload (substituição completa).
"""
import json
import sys
from pathlib import Path

import pandas as pd

from of_common import load_env, neon_connect, copy_dataframe, set_meta

# schema único da síntese: sintese_schema.json na raiz (mesmo arquivo da API e do cliente)
_SCHEMA = json.loads((Path(__file__).resolve().parent.parent / 'sintese_schema.json').read_text(encoding='utf-8'))
COLUNAS = [c['n'] for c in _SCHEMA]
TIPOS = {c['n']: c['t'] for c in _SCHEMA if c['t'] != 'text'}


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
