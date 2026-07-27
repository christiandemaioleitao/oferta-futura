# -*- coding: utf-8 -*-
"""
Gera os arquivos de dados do dashboard Oferta Futura:
  data/dados_of.js  -> window.OF_DATA  (empreendimentos + tipologias + série mensal)
  data/mapa_of.js   -> window.OF_MAPA  (GeoJSON dos terrenos e pontos do KMZ)

Usado de duas formas:
  - pelo pipeline, que chama gerar_dados()/gerar_mapa() com a master já em memória;
  - na mão, a partir de um Excel no mesmo esquema de colunas:
      python scripts/preprocess.py [caminho_xlsx] [caminho_kmz]
"""
import datetime
import json
import os
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTES = os.path.join(BASE, 'fontes')
XLSX_PADRAO = os.path.join(FONTES, 'Projecao_OF.xlsx')
KMZ_PADRAO = os.path.join(FONTES, 'Oferta Futura - 2026.kmz')

NS = {'k': 'http://www.opengis.net/kml/2.2'}
KML = '{http://www.opengis.net/kml/2.2}'

# faixas de área privativa — precisam bater com FAIXAS em js/app.js
FAIXAS = [('f1', 0, 50), ('f2', 50, 70), ('f3', 70, 90),
          ('f4', 90, 120), ('f5', 120, 160), ('f6', 160, float('inf'))]


def faixa_de(area):
    """Devolve a faixa da área privativa. 'f0' = área não informada — precisa existir,
    senão essas unidades somem do gráfico e a quebra não fecha com o total."""
    if area is None:
        return 'f0'
    for fid, ini, fim in FAIXAS:
        if ini <= area < fim:
            return fid
    return 'f0'


def _nan(v):
    return isinstance(v, float) and v != v


def clean(v):
    """Texto normalizado; marcadores de vazio e NaN viram None."""
    if v is None or _nan(v):
        return None
    if isinstance(v, datetime.datetime):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, str):
        s = v.replace('_x000D_', '').strip()
        return None if s in ('', '-', 'nan', 'None') else s
    return v


def num(v):
    try:
        if v is None or v == '' or _nan(v):
            return None
        n = float(v)
        return None if n != n else n
    except (TypeError, ValueError):
        return None


def ym(v):
    s = clean(v)
    return s[:7] if s else None


def gerar_dados(header, linhas, fonte):
    """Monta data/dados_of.js a partir de linhas no esquema da master.

    header: lista de nomes de coluna. linhas: iterável de tuplas na mesma ordem.
    A master tem grão duplo: linhas com id_empreendimento são a projeção da oferta
    futura (grão tipologia x mês); linhas sem id são o histórico de mercado
    (síntese), agregado aqui em médias mensais de venda por empreendimento.
    """
    idx = {h: i for i, h in enumerate(header)}
    emps = {}                                   # id_empreendimento -> dict
    tips = {}                                   # (emp, id_tipologia) -> dict
    # emp -> mês -> [disp, vend, distr, {quartos: disp}, {faixa m²: disp}]
    mensal = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, defaultdict(float), defaultdict(float)]))
    hist = {}                                   # empreendimento de mercado -> dict
    n = 0

    for r in linhas:
        n += 1
        def g(col):
            return r[idx[col]] if col in idx else None

        eid = g('id_empreendimento')
        if eid is None or _nan(eid):
            # linha histórica de mercado (grão = produto x mês): agrega vendas
            hname = clean(g('empreendimento'))
            m = ym(g('data'))
            if not hname or not m:
                continue
            hrec = hist.setdefault(hname, {
                'empreendimento': hname,
                'cluster': clean(g('cluster')),
                'bairro': clean(g('bairro')),
                'tipo': clean(g('TipoEmpreendimento')),
                'macrozona': clean(g('macrozona')),
                'dtLancamento': clean(g('dtlançamento')),
                'vend': defaultdict(float), 'minM': m, 'maxM': m,
            })
            hrec['minM'] = min(hrec['minM'], m)
            hrec['maxM'] = max(hrec['maxM'], m)
            v = num(g('unidadesvendidasmes')) or 0
            if v:
                hrec['vend'][m] += v
            continue

        eid = str(int(eid)) if isinstance(eid, float) else str(eid)
        if eid not in emps:
            emps[eid] = {
                'id': eid,
                'empreendimento': clean(g('empreendimento')),
                'cidade': clean(g('cidade')),
                'uf': clean(g('Cidade.Uf')),
                'bairro': clean(g('bairro')),
                'incorporadora': clean(g('incorporadora')),
                'tipo': clean(g('TipoEmpreendimento')),
                'macrozona': clean(g('macrozona')),
                'lat': num(g('Latitude')),
                'lng': num(g('Longitude')),
                'logradouro': clean(g('Logradouro')),
                'complemento': clean(g('Complemento')),
                'areaTerreno': num(g('AreaTerreno')),
                'totalUnidades': num(g('TotalUnidades')),
                'dtLancamento': clean(g('dtlançamento')),
                'descPavimentos': clean(g('descPavimentos')),
                'adensamento': num(g('Adensamento')),
                'mcmv': str(g('MCMV')).strip().lower() in ('true', '1', 'sim'),
                'observacao': clean(g('Observacao')),
                'terrenoTapumado': bool(g('TerrenoTapumado')) if g('TerrenoTapumado') is not None else None,
                'projetoProtocolado': bool(g('ProjetoProtocolado')) if g('ProjetoProtocolado') is not None else None,
                'projetoAprovado': bool(g('ProjetoAprovado')) if g('ProjetoAprovado') is not None else None,
                'idProtocolo': clean(g('IdProtocoloProjeto')),
                'dataProtocolo': clean(g('DataProtocoloProjeto')),
                'dataAprovacao': clean(g('DataAprovacao')),
                'linkProjeto': clean(g('LinkDoProjeto')),
                'linkPortal': clean(g('LinkPortal')),
                'fonteEmpreendimento': clean(g('FonteEmpreendimento')),
                'fonteDataLancamento': clean(g('FonteDataLancamento')),
                'fonteTipologia': clean(g('FonteTipologia')),
                'fontePrevisao': clean(g('FonteDataPrevisaoLancamento')),
                'cluster': clean(g('cluster')),
                'consideracaoOF': clean(g('consideracao_OF')),
            }

        tkey = (eid, str(g('id_tipologia')))
        if tkey not in tips:
            tips[tkey] = {
                'emp': eid,
                'tipologia': clean(g('tipologia')),
                'tratada': clean(g('tipologia_tratada')),
                'unids': num(g('Unids_tipologia')) or 0,
                'area': num(g('AreaPrivativa')),
            }

        m = ym(g('data'))
        if m:
            cel = mensal[eid][m]
            disp = num(g('unidadesdisponiveis')) or 0
            # a linha é por tipologia, então somar disponíveis do mês é correto
            cel[0] += disp
            cel[1] += num(g('unidadesvendidasmes')) or 0
            cel[2] += num(g('unidadesdistratadasmes')) or 0
            # quebras da visão Detalhado: por nº de quartos (0 = comercial) e por faixa de m²
            try:
                tq = min(max(int(float(g('tipologia_tratada') or 0)), 0), 4)
            except (TypeError, ValueError):
                tq = 0
            cel[3][str(tq)] += disp
            cel[4][faixa_de(num(g('AreaPrivativa')))] += disp

    print('linhas:', n, '| empreendimentos:', len(emps), '| tipologias:', len(tips))

    for (eid, _tid), t in tips.items():
        emps[eid].setdefault('tipologias', []).append(
            {k: t[k] for k in ('tipologia', 'tratada', 'unids', 'area')})
    for eid, mm in mensal.items():
        emps[eid]['mensal'] = [
            {'m': m, 'disp': round(v[0], 1), 'vend': round(v[1], 2), 'distr': round(v[2], 2),
             'tip': {k: round(x, 1) for k, x in sorted(v[3].items()) if x},
             'fx': {k: round(x, 1) for k, x in sorted(v[4].items()) if x}}
            for m, v in sorted(mm.items())
        ]

    historico = [{
        'empreendimento': h['empreendimento'], 'cluster': h['cluster'],
        'bairro': h['bairro'], 'tipo': h['tipo'], 'macrozona': h['macrozona'],
        'dtLancamento': h['dtLancamento'], 'minM': h['minM'], 'maxM': h['maxM'],
        'vend': [[m, round(v, 1)] for m, v in sorted(h['vend'].items())],
    } for h in hist.values()]
    print('histórico mercado:', len(historico), 'empreendimentos')

    data = {'geradoEm': datetime.date.today().isoformat(), 'fonte': fonte,
            'empreendimentos': list(emps.values()), 'historico': historico}
    destino = os.path.join(BASE, 'data', 'dados_of.js')
    with open(destino, 'w', encoding='utf-8') as f:
        f.write('window.OF_DATA=')
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        f.write(';')
    print('OK ->', destino, round(os.path.getsize(destino) / 1048576, 2), 'MB')
    return len(emps)


def _kml_color(el):
    """Cor do KML (aabbggrr) para hexadecimal do CSS."""
    if el is None or not el.text:
        return None
    c = el.text.strip()
    return '#' + c[6:8] + c[4:6] + c[2:4] if len(c) == 8 else None


def gerar_mapa(kmz_path=KMZ_PADRAO):
    """Monta data/mapa_of.js com os terrenos (polígonos) e localizações (pontos) do KMZ."""
    print('Lendo', kmz_path)
    with zipfile.ZipFile(kmz_path) as z:
        nome_kml = [x for x in z.namelist() if x.lower().endswith('.kml')][0]
        root = ET.fromstring(z.read(nome_kml).decode('utf-8'))

    styles = {}
    for st in root.iter(KML + 'Style'):
        sid = st.get('id')
        if not sid:
            continue
        styles[sid] = {
            'fill': _kml_color(st.find('.//k:PolyStyle/k:color', NS)),
            'stroke': _kml_color(st.find('.//k:LineStyle/k:color', NS)),
            'icon': _kml_color(st.find('.//k:IconStyle/k:color', NS)),
        }
    stylemaps = {}
    for sm in root.iter(KML + 'StyleMap'):
        for par in sm.findall('k:Pair', NS):
            if par.findtext('k:key', '', NS) == 'normal':
                stylemaps[sm.get('id')] = par.findtext('k:styleUrl', '', NS).lstrip('#')

    def resolve_style(url):
        if not url:
            return {}
        sid, visto = url.lstrip('#'), set()
        while sid in stylemaps and sid not in visto:
            visto.add(sid)
            sid = stylemaps[sid]
        return styles.get(sid, {})

    def parse_coords(txt):
        pts = []
        for tok in (txt or '').split():
            p = tok.split(',')
            if len(p) >= 2:
                pts.append([round(float(p[0]), 6), round(float(p[1]), 6)])
        return pts

    pai = {filho: p for p in root.iter() for filho in p}

    def pasta_de(el):
        p = pai.get(el)
        while p is not None:
            if p.tag == KML + 'Folder':
                return p.findtext('k:name', '', NS)
            p = pai.get(p)
        return ''

    features = []
    for pm in root.iter(KML + 'Placemark'):
        nome = (pm.findtext('k:name', '', NS) or '').strip()
        stl = resolve_style(pm.findtext('k:styleUrl', '', NS))
        props = {'name': nome, 'folder': pasta_de(pm),
                 'desc': (pm.findtext('k:description', '', NS) or '').strip()[:500]}
        ponto = pm.find('.//k:Point/k:coordinates', NS)
        poly = pm.find('.//k:Polygon//k:outerBoundaryIs//k:coordinates', NS)
        if ponto is not None:
            c = parse_coords(ponto.text)
            if c:
                features.append({'type': 'Feature',
                                 'properties': {**props, 'kind': 'ponto', 'color': stl.get('icon')},
                                 'geometry': {'type': 'Point', 'coordinates': c[0]}})
        elif poly is not None:
            c = parse_coords(poly.text)
            if len(c) >= 3:
                features.append({'type': 'Feature',
                                 'properties': {**props, 'kind': 'terreno',
                                                'fill': stl.get('fill'), 'stroke': stl.get('stroke')},
                                 'geometry': {'type': 'Polygon', 'coordinates': [c]}})

    geo = {'type': 'FeatureCollection', 'name': 'Oferta Futura - 2026', 'features': features}
    destino = os.path.join(BASE, 'data', 'mapa_of.js')
    with open(destino, 'w', encoding='utf-8') as f:
        f.write('window.OF_MAPA=')
        json.dump(geo, f, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        f.write(';')
    print('OK ->', destino, round(os.path.getsize(destino) / 1024, 1), 'KB |', len(features), 'features')
    return len(features)


def gerar_de_dataframe(df, fonte, kmz_path=KMZ_PADRAO):
    """Caminho usado pelo pipeline: master em memória, sem passar por Excel."""
    gerar_dados(list(df.columns), df.itertuples(index=False, name=None), fonte)
    gerar_mapa(kmz_path)


def main():
    xlsx = sys.argv[1] if len(sys.argv) > 1 else XLSX_PADRAO
    kmz = sys.argv[2] if len(sys.argv) > 2 else KMZ_PADRAO
    import openpyxl
    print('Lendo', xlsx)
    ws = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)['Sheet1']
    linhas = ws.iter_rows(values_only=True)
    header = [str(h) for h in next(linhas)]
    gerar_dados(header, linhas, os.path.basename(xlsx))
    gerar_mapa(kmz)


if __name__ == '__main__':
    main()
