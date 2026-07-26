# -*- coding: utf-8 -*-
"""
Pré-processamento do dashboard Oferta Futura.
Lê Projecao_OF.xlsx e Oferta Futura - 2026.kmz e gera:
  data/dados_of.js  -> window.OF_DATA  (empreendimentos + tipologias + série mensal)
  data/mapa_of.js   -> window.OF_MAPA  (GeoJSON dos terrenos e pontos do KMZ)
Uso:
  python scripts/preprocess.py [caminho_xlsx] [caminho_kmz]
"""
import sys, os, json, re, zipfile, datetime
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\christian.leitao\Documents\Analise Oferta Futura - 07.26\novo-dashboard-of\Projecao_OF.xlsx"
KMZ  = sys.argv[2] if len(sys.argv) > 2 else r"C:\Users\christian.leitao\Documents\Analise Oferta Futura - 07.26\novo-dashboard-of\Oferta Futura - 2026.kmz"

def clean(v):
    if v is None: return None
    if isinstance(v, datetime.datetime): return v.strftime('%Y-%m-%d')
    if isinstance(v, str):
        s = v.replace('_x000D_', '').strip()
        if s in ('', '-', 'nan', 'None'): return None
        return s
    return v

def num(v):
    try:
        if v is None or v == '': return None
        return float(v)
    except Exception:
        return None

def ym(v):
    s = clean(v)
    return s[:7] if s else None

# ---------------- EXCEL ----------------
import openpyxl
print('Lendo', XLSX)
wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
ws = wb['Sheet1']
rows = ws.iter_rows(values_only=True)
header = [str(h) for h in next(rows)]
idx = {h: i for i, h in enumerate(header)}

emps = {}                                   # id_empreendimento -> dict
tips = {}                                   # (emp, id_tipologia) -> dict
mensal = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))  # emp -> 'YYYY-MM' -> [disp, vend, distr]
hist = {}                                   # empreendimento histórico (mercado) -> dict
n = 0
for r in rows:
    n += 1
    def g(col): return r[idx[col]] if col in idx else None
    eid = g('id_empreendimento')
    if eid is None:
        # linha histórica de mercado (grão = unidade × mês): agrega vendas p/ médias mensais
        hname = clean(g('empreendimento'))
        m = ym(g('data'))
        if not hname or not m: continue
        hrec = hist.setdefault(hname, {
            'empreendimento': hname,
            'cluster': clean(g('cluster')),
            'bairro': clean(g('bairro')),
            'tipo': clean(g('TipoEmpreendimento')),
            'macrozona': clean(g('macrozona')),
            'dtLancamento': clean(g('dtlançamento')),
            'vend': defaultdict(float), 'minM': m, 'maxM': m,
        })
        hrec['minM'] = min(hrec['minM'], m); hrec['maxM'] = max(hrec['maxM'], m)
        v = num(g('unidadesvendidasmes')) or 0
        if v: hrec['vend'][m] += v
        continue
    eid = str(eid)
    if eid not in emps:
        emps[eid] = {
            'id': eid,
            'empreendimento': clean(g('empreendimento')),
            'cidade': clean(g('cidade')),
            'uf': clean(g('Cidade.Uf')),
            'bairro': clean(g('bairro')),
            'incorporadora': clean(g('incorporadora')),
            'incorpOUconsorcio': clean(g('incorpOUconsorcio')),
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
            'mcmv': clean(g('MCMV')),
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
            'lancamento': clean(g('lancamento')),
        }
    tid = g('id_tipologia')
    tkey = (eid, str(tid))
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
        cel[0] += num(g('unidadesdisponiveis')) or 0
        # divide pelas tipologias depois? não: linha é por tipologia; disponíveis é por tipologia — soma correta
        cel[1] += num(g('unidadesvendidasmes')) or 0
        cel[2] += num(g('unidadesdistratadasmes')) or 0

print('linhas:', n, '| empreendimentos:', len(emps), '| tipologias:', len(tips))

for (eid, tid), t in tips.items():
    emps[eid].setdefault('tipologias', []).append({k: t[k] for k in ('tipologia', 'tratada', 'unids', 'area')})
for eid, mm in mensal.items():
    emps[eid]['mensal'] = [{'m': m, 'disp': round(v[0], 1), 'vend': round(v[1], 2), 'distr': round(v[2], 2)} for m, v in sorted(mm.items())]

historico = []
for hrec in hist.values():
    historico.append({
        'empreendimento': hrec['empreendimento'], 'cluster': hrec['cluster'],
        'bairro': hrec['bairro'], 'tipo': hrec['tipo'], 'macrozona': hrec['macrozona'],
        'dtLancamento': hrec['dtLancamento'], 'minM': hrec['minM'], 'maxM': hrec['maxM'],
        'vend': [[m, round(v, 1)] for m, v in sorted(hrec['vend'].items())],
    })
print('histórico mercado:', len(historico), 'empreendimentos')

data = {'geradoEm': datetime.date.today().isoformat(), 'fonte': os.path.basename(XLSX), 'empreendimentos': list(emps.values()), 'historico': historico}
out1 = os.path.join(BASE, 'data', 'dados_of.js')
with open(out1, 'w', encoding='utf-8') as f:
    f.write('window.OF_DATA=')
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';')
print('OK ->', out1, round(os.path.getsize(out1) / 1048576, 2), 'MB')

# ---------------- KMZ ----------------
print('Lendo', KMZ)
with zipfile.ZipFile(KMZ) as z:
    kml_name = [x for x in z.namelist() if x.lower().endswith('.kml')][0]
    kml = z.read(kml_name).decode('utf-8')

import xml.etree.ElementTree as ET
ns = {'k': 'http://www.opengis.net/kml/2.2'}
root = ET.fromstring(kml)

# estilos -> cor
styles = {}
for st in root.iter('{http://www.opengis.net/kml/2.2}Style'):
    sid = st.get('id')
    if not sid: continue
    poly = st.find('.//k:PolyStyle/k:color', ns)
    line = st.find('.//k:LineStyle/k:color', ns)
    icon = st.find('.//k:IconStyle/k:color', ns)
    def kml_color(el):
        if el is None or not el.text: return None
        c = el.text.strip()  # aabbggrr
        if len(c) == 8:
            return '#' + c[6:8] + c[4:6] + c[2:4]
        return None
    styles[sid] = {'fill': kml_color(poly), 'stroke': kml_color(line), 'icon': kml_color(icon)}
stylemaps = {}
for sm in root.iter('{http://www.opengis.net/kml/2.2}StyleMap'):
    sid = sm.get('id')
    for pair in sm.findall('k:Pair', ns):
        if pair.findtext('k:key', '', ns) == 'normal':
            url = pair.findtext('k:styleUrl', '', ns).lstrip('#')
            stylemaps[sid] = url

def resolve_style(url):
    if not url: return {}
    sid = url.lstrip('#')
    seen = set()
    while sid in stylemaps and sid not in seen:
        seen.add(sid); sid = stylemaps[sid]
    return styles.get(sid, {})

def parse_coords(txt):
    pts = []
    for tok in (txt or '').split():
        p = tok.split(',')
        if len(p) >= 2:
            pts.append([round(float(p[0]), 6), round(float(p[1]), 6)])
    return pts

features = []
parent = {c: p for p in root.iter() for c in p}
def folder_of(el):
    p = parent.get(el)
    while p is not None:
        if p.tag == '{http://www.opengis.net/kml/2.2}Folder':
            return p.findtext('k:name', '', ns)
        p = parent.get(p)
    return ''
for pm in root.iter('{http://www.opengis.net/kml/2.2}Placemark'):
    if True:
        fname = folder_of(pm)
        name = (pm.findtext('k:name', '', ns) or '').strip()
        surl = pm.findtext('k:styleUrl', '', ns)
        stl = resolve_style(surl)
        desc = (pm.findtext('k:description', '', ns) or '').strip()
        point = pm.find('.//k:Point/k:coordinates', ns)
        poly = pm.find('.//k:Polygon//k:outerBoundaryIs//k:coordinates', ns)
        if point is not None:
            c = parse_coords(point.text)
            if c:
                features.append({'type': 'Feature', 'properties': {'name': name, 'folder': fname, 'kind': 'ponto', 'color': stl.get('icon'), 'desc': desc[:500]}, 'geometry': {'type': 'Point', 'coordinates': c[0]}})
        elif poly is not None:
            c = parse_coords(poly.text)
            if len(c) >= 3:
                features.append({'type': 'Feature', 'properties': {'name': name, 'folder': fname, 'kind': 'terreno', 'fill': stl.get('fill'), 'stroke': stl.get('stroke'), 'desc': desc[:500]}, 'geometry': {'type': 'Polygon', 'coordinates': [c]}})

geo = {'type': 'FeatureCollection', 'name': 'Oferta Futura - 2026', 'features': features}
out2 = os.path.join(BASE, 'data', 'mapa_of.js')
with open(out2, 'w', encoding='utf-8') as f:
    f.write('window.OF_MAPA=')
    json.dump(geo, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';')
print('OK ->', out2, round(os.path.getsize(out2) / 1024, 1), 'KB |', len(features), 'features')
