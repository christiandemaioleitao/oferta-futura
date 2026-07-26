# -*- coding: utf-8 -*-
"""
Conexões e utilitários compartilhados do pipeline Oferta Futura.

Variáveis de ambiente (podem vir de um arquivo .env na raiz do repo):
  NEON_DATABASE_URL    postgresql://user:pass@host/db?sslmode=require
  SQLSERVER_HOST       ex: 207.244.233.6
  SQLSERVER_DB         ex: EBMSimulacaoHML
  SQLSERVER_USER
  SQLSERVER_PASSWORD
"""
import io
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env():
    """Carrega .env da raiz do repo (linhas KEY=VALUE), sem sobrescrever o ambiente."""
    path = os.path.join(BASE, '.env')
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def env(name, default=None):
    v = os.environ.get(name, default)
    if v is None:
        raise SystemExit(f"Variável de ambiente obrigatória ausente: {name}")
    return v


def neon_connect():
    import psycopg2
    return psycopg2.connect(env('NEON_DATABASE_URL'))


def sqlserver_connect():
    """Tenta pyodbc (Windows local) e cai para pymssql (GitHub Actions)."""
    host = env('SQLSERVER_HOST')
    db = env('SQLSERVER_DB')
    user = env('SQLSERVER_USER')
    pwd = env('SQLSERVER_PASSWORD')
    try:
        import pyodbc
        drivers = [d for d in pyodbc.drivers() if 'SQL Server' in d]
        driver = 'ODBC Driver 18 for SQL Server' if 'ODBC Driver 18 for SQL Server' in drivers else drivers[0]
        return pyodbc.connect(
            f"DRIVER={{{driver}}};SERVER={host};DATABASE={db};UID={user};PWD={pwd};"
            "TrustServerCertificate=yes;Encrypt=yes;", timeout=30)
    except ImportError:
        import pymssql
        return pymssql.connect(server=host, database=db, user=user, password=pwd,
                               timeout=60, login_timeout=30)


def copy_dataframe(pg_conn, df, table, dtypes):
    """(Re)cria a tabela no Neon e carrega o DataFrame via COPY (rápido p/ 100k+ linhas).

    dtypes: dict coluna -> tipo SQL (a ordem das colunas do df é preservada).
    """
    cols = list(df.columns)
    ddl_cols = ', '.join(f'"{c}" {dtypes.get(c, "text")}' for c in cols)
    buf = io.StringIO()
    df.to_csv(buf, index=False, header=False, na_rep='\\N')
    buf.seek(0)
    cur = pg_conn.cursor()
    cur.execute(f'DROP TABLE IF EXISTS "{table}"')
    cur.execute(f'CREATE TABLE "{table}" ({ddl_cols})')
    col_list = ', '.join(f'"{c}"' for c in cols)
    cur.execute("SET statement_timeout = '600s'")
    cur.copy_expert(
        f'COPY "{table}" ({col_list}) FROM STDIN WITH (FORMAT csv, NULL \'\\N\')', buf)
    pg_conn.commit()


def set_meta(pg_conn, key, value):
    cur = pg_conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS of_meta (
        chave text PRIMARY KEY, valor text, atualizado_em timestamptz DEFAULT now())""")
    cur.execute("""INSERT INTO of_meta (chave, valor, atualizado_em) VALUES (%s, %s, now())
        ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()""",
        (key, str(value)))
    pg_conn.commit()
