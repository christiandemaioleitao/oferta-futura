# -*- coding: utf-8 -*-
"""
Converte o export "DownloadLayout" do Brain (CSV com ';' e vírgula decimal) para o
layout da sintese_consolidada (23 colunas) e grava comprimido em fontes/.

Uso:
  python scripts/converter_download_layout.py "C:/caminho/DownloadLayout8204.csv"

Decisões (validadas com o usuário em 07/2026):
  - Só GOIANIA e APARECIDA DE GOIANIA — o restante do export (Campinas, Brasília...)
    não pertence ao mercado acompanhado e distorceria curvas e estoque.
  - As linhas de consórcio NÃO são deduplicadas: o mesmo empreendimento aparece uma
    vez por incorporadora consorciada e o estoque oficial soma todas (13.107 un em
    03/2026). O grão de produto do pipeline inclui a incorporadora, então numerador
    e denominador das curvas ficam consistentes com essa contagem.
"""
import os
import sys

import pandas as pd

from of_common import BASE

CIDADES = ['GOIANIA', 'APARECIDA DE GOIANIA']
COLUNAS = [
    'cidade', 'bairro', 'incorporadora', 'tipoempreendimento', 'empreendimento',
    'datainobr', 'datahabt', 'regional', 'consorcio', 'totalunidades', 'privativa',
    'unidadesvendidasmes', 'unidadesdistratadasmes', 'unidadesdisponiveis',
    'percevolucaoobra', 'tipologia', 'precounidade', 'datalancamento', 'data',
    'macroregiao', 'latitude', 'longitude', 'lancou',
]
DATAS = ['datainobr', 'datahabt', 'datalancamento', 'data']
SAIDA = os.path.join(BASE, 'fontes', 'sintese_consolidada.csv.gz')


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Uso: python scripts/converter_download_layout.py <DownloadLayout.csv>')
    origem = sys.argv[1]
    print('Lendo', origem)
    df = pd.read_csv(origem, sep=';', encoding='utf-8-sig', decimal=',', low_memory=False)
    df.columns = [str(c).strip().lower() for c in df.columns]
    faltando = [c for c in COLUNAS if c not in df.columns]
    if faltando:
        raise SystemExit(f'Colunas ausentes no export: {faltando}')

    antes = len(df)
    df = df[df['cidade'].isin(CIDADES)].copy()
    print(f'Filtro de cidades: {antes} -> {len(df)} linhas ({", ".join(CIDADES)})')

    df = df[COLUNAS]
    for c in DATAS:
        df[c] = pd.to_datetime(df[c], format='%d/%m/%Y %H:%M:%S', errors='coerce').dt.date

    df.to_csv(SAIDA, index=False, encoding='utf-8', compression='gzip')
    mb = os.path.getsize(SAIDA) / 1e6
    print(f'OK: {len(df)} linhas -> {SAIDA} ({mb:.1f} MB)')

    # conferência de estoque nos dois últimos meses do arquivo (o último pode estar parcial)
    chk = df.copy()
    chk['data'] = pd.to_datetime(chk['data'])
    for ult in sorted(chk['data'].dropna().unique())[-2:]:
        est = chk[chk['data'] == ult]['unidadesdisponiveis'].sum()
        print(f'Estoque em {pd.Timestamp(ult):%m/%Y} (soma bruta, como a planilha): {est:,.0f} unidades')


if __name__ == '__main__':
    main()
