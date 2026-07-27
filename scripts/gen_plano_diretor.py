# -*- coding: utf-8 -*-
"""Converte o KMZ do Plano Diretor de Goiânia 2022 em arquivos por camada.

O KMZ tem ~36 MB de KML e 880 mil vértices — carregar isso junto com o dashboard
travaria a página. Aqui cada pasta do KMZ vira um arquivo próprio em
data/plano_diretor/, com a geometria simplificada (Douglas-Peucker) e as
coordenadas arredondadas. O dashboard baixa cada arquivo só quando o usuário
liga aquela camada.

Uso único — o Plano Diretor não muda. Rodar de novo só se o KMZ for atualizado:
  python scripts/gen_plano_diretor.py "caminho/Plano Diretor de Goiânia 2022.kmz"
"""
import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from shapely.geometry import LineString, Polygon

BASE = Path(__file__).resolve().parent.parent
KMZ = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / 'fontes' / 'Plano Diretor de Goiania 2022.kmz'
OUT_DIR = BASE / 'data' / 'plano_diretor'
INDICE = BASE / 'data' / 'plano_diretor.js'

K = '{http://www.opengis.net/kml/2.2}'
TOLERANCIA = 0.00005   # ~5,5 m — imperceptível na escala do mapa
CASAS = 5              # ~1,1 m por casa decimal

# uma cor por camada; agrupadas por tema para o painel do mapa
CAMADAS = [
    ('Macrozoneamento',                     'Estrutura',  '#0C1F55'),
    ('LIMITE DO MUNICÍPIO',                 'Estrutura',  '#111827'),
    ('Corredores',                          'Estrutura',  '#B45309'),
    ('Vias',                                'Estrutura',  '#78350F'),
    ('Eixo de Desenvolvimento - ED',        'Estrutura',  '#C2410C'),
    ('Influência das Vias Expressas - Ive', 'Estrutura',  '#EA580C'),
    ('Áreas Adensáveis - AA',               'Densidade',  '#15803D'),
    ('Áreas de Desaceleração de Densidade - ADD', 'Densidade', '#B91C1C'),
    ('Áreas de Ocupação Sustentável - AOS', 'Densidade',  '#65A30D'),
    ('Outorga Onerosa de Alteração de Uso - OOAU', 'Densidade', '#7C3AED'),
    ('Declividade acima de 30%',            'Ambiental',  '#92400E'),
    ('Áreas de Restrição Ambiental Rural - Arar / Área Especial de Desenvolvimento Econômico - AEDE', 'Ambiental', '#0F766E'),
    ('Áreas de Restrição Ambiental Rural - Arar / Area de Proteção Permanente - APP', 'Ambiental', '#047857'),
    ("Áreas de Restrição Ambiental Rural - Arar / Unidades de Conservação / UUS's", 'Ambiental', '#059669'),
    ('Áreas de Restrição Ambiental Urbana - Arau / Area de Proteção Permanente - APP', 'Ambiental', '#10B981'),
    ("Áreas de Restrição Ambiental Urbana - Arau / Unidades de Conservação / UUS's", 'Ambiental', '#34D399'),
    ('Áreas de Restrição Ambiental Urbana - Arau / Jardim Botânico', 'Ambiental', '#6EE7B7'),
    ('Programas Especiais / Áreas de Programas Especiais de Interesse Social - AEIS',      'Programas', '#1D4ED8'),
    ('Programas Especiais / Áreas de Programas Especiais de Interesse Urbanístico',        'Programas', '#2563EB'),
    ('Programas Especiais / Áreas de Programas Especiais de Interesse Ambiental',          'Programas', '#0891B2'),
    ('Programas Especiais / Áreas de Programas Especiais de Interesse Econômico',          'Programas', '#4F46E5'),
    ('Áreas de Patrimonio Cultural -Apac',  'Programas',  '#A21CAF'),
]
# nomes curtos para o painel (o KMZ repete o prefixo da categoria em cada pasta)
CURTO = {
    'Áreas de Restrição Ambiental Rural - Arar / Área Especial de Desenvolvimento Econômico - AEDE': 'Arar · AEDE',
    'Áreas de Restrição Ambiental Rural - Arar / Area de Proteção Permanente - APP': 'Arar · APP',
    "Áreas de Restrição Ambiental Rural - Arar / Unidades de Conservação / UUS's": 'Arar · Unidades de Conservação',
    'Áreas de Restrição Ambiental Urbana - Arau / Area de Proteção Permanente - APP': 'Arau · APP',
    "Áreas de Restrição Ambiental Urbana - Arau / Unidades de Conservação / UUS's": 'Arau · Unidades de Conservação',
    'Áreas de Restrição Ambiental Urbana - Arau / Jardim Botânico': 'Arau · Jardim Botânico',
    'Programas Especiais / Áreas de Programas Especiais de Interesse Social - AEIS': 'Interesse Social - AEIS',
    'Programas Especiais / Áreas de Programas Especiais de Interesse Urbanístico': 'Interesse Urbanístico',
    'Programas Especiais / Áreas de Programas Especiais de Interesse Ambiental': 'Interesse Ambiental',
    'Programas Especiais / Áreas de Programas Especiais de Interesse Econômico': 'Interesse Econômico',
    'Áreas de Patrimonio Cultural -Apac': 'Patrimônio Cultural - Apac',
    'Áreas de Ocupação Sustentável - AOS': 'Ocupação Sustentável - AOS',
    'Áreas de Desaceleração de Densidade - ADD': 'Desaceleração de Densidade - ADD',
    'Áreas Adensáveis - AA': 'Adensáveis - AA',
    'Outorga Onerosa de Alteração de Uso - OOAU': 'Outorga Onerosa - OOAU',
    'Eixo de Desenvolvimento - ED': 'Eixo de Desenvolvimento',
    'Influência das Vias Expressas - Ive': 'Vias Expressas - Ive',
    'LIMITE DO MUNICÍPIO': 'Limite do município',
    'Declividade acima de 30%': 'Declividade > 30%',
}


def slug(s):
    """Identificador de arquivo. Trunca pelo FIM: os nomes do KMZ compartilham
    prefixos longos ('Programas Especiais / Áreas de Programas Especiais de …')
    e cortar pelo início fazia quatro camadas colidirem no mesmo arquivo."""
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode()
    limpo = re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', s.lower())).strip('-')
    return limpo if len(limpo) <= 60 else limpo[-60:].lstrip('-')


def norm(s):
    """Compara nomes de pasta ignorando acento, caixa e espaços repetidos."""
    s = unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', s).strip().lower()


def coords(txt):
    pts = []
    for tok in (txt or '').split():
        p = tok.split(',')
        if len(p) >= 2:
            pts.append((float(p[0]), float(p[1])))
    return pts


def simplificar(pts, fechado):
    """Douglas-Peucker + arredondamento. Devolve [[lat,lng],...] para o Leaflet."""
    if len(pts) < (4 if fechado else 2):
        return None
    try:
        geo = Polygon(pts) if fechado else LineString(pts)
        if not geo.is_valid:
            geo = geo.buffer(0)
        geo = geo.simplify(TOLERANCIA, preserve_topology=True)
        if geo.is_empty:
            return None
        if geo.geom_type == 'Polygon':
            saida = list(geo.exterior.coords)
        elif geo.geom_type in ('MultiPolygon', 'GeometryCollection'):
            maior = max(geo.geoms, key=lambda g: getattr(g, 'area', 0))
            saida = list(maior.exterior.coords) if maior.geom_type == 'Polygon' else list(maior.coords)
        else:
            saida = list(geo.coords)
    except Exception:
        saida = pts
    latlng = [[round(y, CASAS), round(x, CASAS)] for x, y in saida]
    # remove vértices repetidos em sequência (o arredondamento cria alguns)
    limpo = [latlng[0]]
    for p in latlng[1:]:
        if p != limpo[-1]:
            limpo.append(p)
    return limpo if len(limpo) >= (3 if fechado else 2) else None


def main():
    print('Lendo', KMZ)
    with zipfile.ZipFile(KMZ) as z:
        nome_kml = [n for n in z.namelist() if n.lower().endswith('.kml')][0]
        root = ET.fromstring(z.read(nome_kml).decode('utf-8', 'replace'))

    pastas = {}
    for f in root.iter(K + 'Folder'):
        nome = (f.findtext(K + 'name') or '').strip()
        if nome:
            pastas.setdefault(norm(nome), (nome, f))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for antigo in OUT_DIR.glob('*.json'):
        antigo.unlink()

    indice, v_antes, v_depois, bytes_total = [], 0, 0, 0
    for nome_cfg, grupo, cor in CAMADAS:
        achado = pastas.get(norm(nome_cfg))
        if not achado:
            print('  !! pasta não encontrada no KMZ:', nome_cfg)
            continue
        nome_real, folder = achado
        formas = []
        for pm in folder.iter(K + 'Placemark'):
            rotulo = (pm.findtext(K + 'name') or '').strip()
            for el in pm.iter(K + 'coordinates'):
                pts = coords(el.text)
                v_antes += len(pts)
                fechado = pm.find('.//' + K + 'Polygon') is not None
                linha = simplificar(pts, fechado)
                if linha:
                    v_depois += len(linha)
                    formas.append({'n': rotulo, 'p': linha, 't': 1 if fechado else 0})
        if not formas:
            continue
        arq = slug(nome_cfg) + '.json'
        destino = OUT_DIR / arq
        with open(destino, 'w', encoding='utf-8') as fh:
            json.dump({'formas': formas}, fh, ensure_ascii=False, separators=(',', ':'))
        tam = destino.stat().st_size
        bytes_total += tam
        indice.append({'id': slug(nome_cfg), 'nome': CURTO.get(nome_cfg, nome_cfg),
                       'grupo': grupo, 'cor': cor, 'arq': arq,
                       'formas': len(formas), 'kb': round(tam / 1024)})
        print(f'  {CURTO.get(nome_cfg, nome_cfg)[:44]:<44} {len(formas):>5} formas  {tam/1024:>7.0f} KB')

    with open(INDICE, 'w', encoding='utf-8') as fh:
        fh.write('window.OF_PLANO_DIRETOR=')
        json.dump({'base': 'data/plano_diretor/', 'camadas': indice}, fh,
                  ensure_ascii=False, separators=(',', ':'))
        fh.write(';')
    print(f'\nvértices: {v_antes} -> {v_depois} ({100 - v_depois * 100 // max(v_antes, 1)}% menor)')
    print(f'total em disco: {bytes_total/1048576:.1f} MB em {len(indice)} camadas')
    print('índice ->', INDICE)


if __name__ == '__main__':
    main()
