# -*- coding: utf-8 -*-
"""
Gera os arquivos de dados do dashboard Oferta Futura:
  data/dados_of.js  -> window.OF_DATA  (empreendimentos + tipologias + série mensal)
  data/mapa_of.js   -> window.OF_MAPA  (GeoJSON dos terrenos e pontos do KMZ)

Biblioteca do pipeline: `pipeline_of.py` chama gerar_de_dataframe() com a master
já em memória. Não roda sozinho — o caminho antigo, que lia um Excel intermediário
em fontes/, saiu junto com o próprio Excel: era um retrato congelado da base e
regenerar o dashboard a partir dele publicava dados velhos sem avisar.
"""
import datetime
import json
import os
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTES = os.path.join(BASE, 'fontes')
KMZ_PADRAO = os.path.join(FONTES, 'Oferta Futura - 2026.kmz')

NS = {'k': 'http://www.opengis.net/kml/2.2'}
KML = '{http://www.opengis.net/kml/2.2}'

# faixas de área privativa — precisam bater com FAIXAS em js/app.js
FAIXAS = [('f1', 0, 50), ('f2', 50, 70), ('f3', 70, 100), ('f4', 100, 130),
          ('f5', 130, 190), ('f6', 190, 230), ('f7', 230, 290),
          ('f8', 290, 350), ('f9', 350, float('inf'))]


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


def _norm(v):
    """Chave de comparação de texto: maiúsculas, sem acento, espaços colapsados.

    A síntese e o cadastro do portal grafam o mesmo bairro de jeitos diferentes
    ('JARDIM ATLÂNTICO' x 'JARDIM ATLANTICO'). O filtro do dashboard compara
    string exata, então o mercado é canonizado para a grafia do cadastro."""
    if v is None or _nan(v):
        return ''
    s = unicodedata.normalize('NFKD', str(v)).encode('ascii', 'ignore').decode()
    return ' '.join(s.upper().split())


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


def _montar_sem_previsao(registros):
    """Terrenos monitorados sem data de lançamento/previsão -> array semPrevisao.

    Entram no dados_of.js FORA de 'empreendimentos' de propósito: aparecem nos
    filtros, no mapa e na tabela própria, mas nenhum indicador da projeção os vê.
    dtLancamento/totalUnidades/tipologias/mensal ficam vazios (pedido do usuário:
    não impactar KPIs, gráficos e janela de lançamento)."""
    # NaT do pandas passa no isinstance(datetime) e explode no strftime do clean();
    # NaT != NaT (como NaN), então o guard cobre os dois
    cl = lambda v: None if v is None or v != v else clean(v)
    out = []
    for r in registros or []:
        rid = r.get('id')
        try:
            rid = str(int(float(rid)))
        except (TypeError, ValueError):
            continue
        out.append({
            'id': 'sd-' + rid,
            'empreendimento': cl(r.get('empreendimento')),
            'incorporadora': cl(r.get('incorporadora')),
            'bairro': cl(r.get('bairro')),
            'cidade': cl(r.get('cidade')),
            'uf': cl(r.get('uf')),
            'tipo': cl(r.get('tipo')),
            'macrozona': cl(r.get('macrozona')),
            'lat': num(r.get('lat')) or None,
            'lng': num(r.get('lng')) or None,
            'logradouro': cl(r.get('logradouro')),
            'complemento': cl(r.get('complemento')),
            'areaTerreno': num(r.get('area_terreno')),
            'totalUnidades': None,
            'dtLancamento': None,
            'observacao': cl(r.get('observacao')),
            'projetoProtocolado': str(r.get('projeto_protocolado')).strip().lower() in ('true', '1', 'sim'),
            'projetoAprovado': str(r.get('projeto_aprovado')).strip().lower() in ('true', '1', 'sim'),
            'idProtocolo': cl(r.get('id_protocolo')),
            'dataProtocolo': cl(r.get('data_protocolo')),
            'dataProtocoloOutros': cl(r.get('data_protocolo_outros')),
            'dataAprovacao': cl(r.get('data_aprovacao')),
            'dataRemembramento': cl(r.get('data_remembramento')),
            'linkProjeto': cl(r.get('link_projeto')),
            'linkPortal': cl(r.get('link_portal')),
            'fonteEmpreendimento': cl(r.get('fonte_empreendimento')),
            'tipologias': [],
            'mensal': [],
            'semData': True,
        })
    return out


def _prox_mes(m):
    """'2026-06' -> '2026-07' (vira o ano em dezembro)."""
    y, mo = int(m[:4]), int(m[5:7])
    if mo == 12:
        return f'{y + 1}-01'
    return f'{y}-{mo + 1:02d}'


def _media_vendas_trailing(vendas, mes_ref, janela=6):
    """Vendas médias mensais do produto nos últimos `janela` meses até `mes_ref`.

    vendas: lista ordenada de (m, unidades vendidas). Sem registro -> 0 (o estoque
    do produto é carregado constante, nunca zerado de mentira).
    """
    if not vendas:
        return 0.0
    recentes = [v for m, v in vendas if m <= mes_ref][-janela:]
    if not recentes:
        return 0.0
    return sum(recentes) / len(recentes)


def _montar_mercado(merc, emps, vendas_mercado=None):
    """Estoque do mercado (síntese) com dimensões -> array `mercado`.

    Existe para o gráfico de estoque poder responder aos filtros SEM perder a base
    do mercado: antes só saía `mercadoMensal` (uma série global, sem dimensão), então
    qualquer filtro derrubava o mercado inteiro e a curva virava só a oferta futura.

    Três decisões, todas com efeito nos números:
      1. Só os meses da janela de projeção (do 1º mês da OF em diante). O gráfico
         nunca mostra o histórico anterior e ele responde pela maior parte do peso.
      2. Grafias canonizadas para o cadastro do portal ('JARDIM ATLANTICO' ->
         'JARDIM ATLÂNTICO'): o filtro do front compara string exata.
      3. Empreendimento que JÁ está na projeção sai daqui. Lançado no mês base, ele
         aparece na síntese e na OF ao mesmo tempo; somar os dois contava as mesmas
         unidades duas vezes em toda a janela.
    """
    if not merc:
        return []
    vendas_mercado = vendas_mercado or {}
    meses_of = sorted({x['m'] for e in emps.values() for x in e.get('mensal') or []})
    mes_base = meses_of[0] if meses_of else None
    mes_fim = meses_of[-1] if meses_of else None

    canon = {}
    for campo in ('bairro', 'incorporadora', 'tipo', 'macrozona'):
        canon[campo] = {_norm(e.get(campo)): e.get(campo)
                        for e in emps.values() if clean(e.get(campo)) is not None}
    na_projecao = {_norm(e.get('empreendimento')) for e in emps.values()}

    out, dupes, meses_vistos = [], [], set()
    for (nome_k, _inc_k), r in sorted(merc.items()):
        if nome_k in na_projecao:
            dupes.append(r['empreendimento'])
            continue
        linhas_mes = [(m, v) for m, v in sorted(r['mensal'].items())
                      if (mes_base is None or m >= mes_base) and v[0] > 0]
        if not linhas_mes:
            continue
        # A síntese só publica estoque até a data base; dali em diante a curva do
        # mercado despencaria (10,9 mil un em jun/26 -> 149 em jul/26). O estoque
        # remanescente continua existindo: levar a série adiante até o fim da
        # janela de projeção, decaindo pelo ritmo de vendas do próprio produto
        # (média dos últimos 6 meses). Produto sem vendas registradas carrega o
        # estoque constante — conservador, nunca zera de mentira.
        mes_ultimo, ult = linhas_mes[-1]
        taxa = _media_vendas_trailing(vendas_mercado.get(nome_k), mes_ultimo)
        if mes_fim and mes_ultimo < mes_fim:
            total_ult = ult[0]
            mix_tip, mix_fx, mix_tf = ult[1], ult[2], ult[3]
            estoque = total_ult
            m = _prox_mes(mes_ultimo)
            while m <= mes_fim and estoque > 0:
                estoque = max(estoque - min(taxa, estoque), 0.0)
                if estoque <= 0:
                    break
                frac = estoque / total_ult
                linhas_mes.append((m, [estoque,
                                       {k: x * frac for k, x in mix_tip.items()},
                                       {k: x * frac for k, x in mix_fx.items()},
                                       {k: x * frac for k, x in mix_tf.items()}]))
                m = _prox_mes(m)
        meses_vistos.update(m for m, _ in linhas_mes)
        out.append({
            'id': 'mk-%d' % (len(out) + 1),
            'empreendimento': r['empreendimento'],
            'bairro': canon['bairro'].get(_norm(r['bairro']), r['bairro']),
            'incorporadora': canon['incorporadora'].get(_norm(r['incorporadora']), r['incorporadora']),
            'tipo': canon['tipo'].get(_norm(r['tipo']), r['tipo']),
            'macrozona': canon['macrozona'].get(_norm(r['macrozona']), r['macrozona']),
            'dtLancamento': r['dtLancamento'],
            'mercado': True,
            'tipologias': [t for _k, t in sorted(r['tips'].items(), key=lambda kv: str(kv[0]))],
            'mensal': [{'m': m, 'disp': round(v[0], 1),
                        'tip': {k: round(x, 1) for k, x in sorted(v[1].items()) if x},
                        'fx': {k: round(x, 1) for k, x in sorted(v[2].items()) if x},
                        'tf': {k: round(x, 1) for k, x in sorted(v[3].items()) if x}}
                       for m, v in linhas_mes],
        })
    ini, fim = (min(meses_vistos), max(meses_vistos)) if meses_vistos else ('—', '—')
    print(f'mercado (síntese) com dimensões: {len(out)} empreendimentos, {ini} -> {fim}')
    if dupes:
        print(f'  {len(set(dupes))} já estavam na projeção e saíram do mercado '
              f'(evita dupla contagem): {", ".join(sorted(set(dupes))[:10])}')
    return out


def gerar_dados(header, linhas, fonte, sem_previsao=None, coordenadas=None):
    """Monta data/dados_of.js a partir de linhas no esquema da master.

    header: lista de nomes de coluna. linhas: iterável de tuplas na mesma ordem.
    A master tem grão duplo: linhas com id_empreendimento são a projeção da oferta
    futura (grão tipologia x mês); linhas sem id são o histórico de mercado
    (síntese), agregado aqui em médias mensais de venda por empreendimento.
    sem_previsao: registros da SQL_SEM_PREVISAO -> array separado no OF_DATA.
    """
    idx = {h: i for i, h in enumerate(header)}
    emps = {}                                   # id_empreendimento -> dict
    tips = {}                                   # (emp, id_tipologia) -> dict
    # emp -> mês -> [disp, vend, distr, {quartos: disp}, {faixa m²: disp}, {quartos|faixa: disp}]
    # o cruzamento (tf) existe porque quartos e faixa são duas quebras das MESMAS
    # unidades: com os dois filtros ativos, somar os dois vetores contaria duas vezes
    mensal = defaultdict(lambda: defaultdict(
        lambda: [0, 0, 0, defaultdict(float), defaultdict(float), defaultdict(float)]))
    hist = {}                                   # empreendimento de mercado -> dict
    mercado = defaultdict(float)                # mês -> estoque disponível da síntese
    # mercado com dimensões: (nome, incorporadora) -> registro no formato de
    # 'empreendimentos', para o gráfico de estoque poder filtrar a base do mercado
    # pelos mesmos cortes (bairro, tipo, tipologia, faixa de m²...)
    merc = {}
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
            # estoque do mercado por mês (grão síntese, consórcio somado como na
            # planilha oficial — 13.107 un em 03/2026); alimenta a linha "Mercado"
            disp = num(g('unidadesdisponiveis')) or 0
            mercado[m] += disp
            # mesmo estoque, agora guardado com as dimensões do produto: em consórcio
            # cada membro é um registro (o grão oficial do estoque inclui a incorporadora)
            inc = clean(g('incorporadora'))
            mrec = merc.setdefault((_norm(hname), _norm(inc)), {
                'empreendimento': hname, 'incorporadora': inc,
                'bairro': clean(g('bairro')), 'tipo': clean(g('TipoEmpreendimento')),
                'macrozona': clean(g('macrozona')), 'dtLancamento': clean(g('dtlançamento')),
                'tips': {},
                'mensal': defaultdict(
                    lambda: [0.0, defaultdict(float), defaultdict(float), defaultdict(float)]),
            })
            area = num(g('AreaPrivativa'))
            trat = num(g('tipologia_tratada'))
            # tipologias do produto: alimentam os filtros de tipologia e faixa de m²
            tk = (trat, area)
            if tk not in mrec['tips']:
                mrec['tips'][tk] = {'tipologia': clean(g('tipologia')), 'tratada': trat,
                                    'unids': num(g('TotalUnidades')) or 0, 'area': area}
            cel = mrec['mensal'][m]
            cel[0] += disp
            try:
                tq = min(max(int(float(trat or 0)), 0), 4)
            except (TypeError, ValueError):
                tq = 0
            fx = faixa_de(area)
            cel[1][str(tq)] += disp
            cel[2][fx] += disp
            cel[3][f'{tq}|{fx}'] += disp
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
                'dataProtocoloOutros': clean(g('DataProtocoloProjetoOutros')),
                'dataAprovacao': clean(g('DataAprovacao')),
                'dataRemembramento': clean(g('DataRemembramentoDesmembramento')),
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
            fx = faixa_de(num(g('AreaPrivativa')))
            cel[3][str(tq)] += disp
            cel[4][fx] += disp
            cel[5][f'{tq}|{fx}'] += disp

    print('linhas:', n, '| empreendimentos:', len(emps), '| tipologias:', len(tips))

    for (eid, _tid), t in tips.items():
        emps[eid].setdefault('tipologias', []).append(
            {k: t[k] for k in ('tipologia', 'tratada', 'unids', 'area')})
    for eid, mm in mensal.items():
        emps[eid]['mensal'] = [
            {'m': m, 'disp': round(v[0], 1), 'vend': round(v[1], 2), 'distr': round(v[2], 2),
             'tip': {k: round(x, 1) for k, x in sorted(v[3].items()) if x},
             'fx': {k: round(x, 1) for k, x in sorted(v[4].items()) if x},
             'tf': {k: round(x, 1) for k, x in sorted(v[5].items()) if x}}
            for m, v in sorted(mm.items())
        ]

    historico = [{
        'empreendimento': h['empreendimento'], 'cluster': h['cluster'],
        'bairro': h['bairro'], 'tipo': h['tipo'], 'macrozona': h['macrozona'],
        'dtLancamento': h['dtLancamento'], 'minM': h['minM'], 'maxM': h['maxM'],
        'vend': [[m, round(v, 1)] for m, v in sorted(h['vend'].items())],
    } for h in hist.values()]
    print('histórico mercado:', len(historico), 'empreendimentos')

    sem_prev = _montar_sem_previsao(sem_previsao)
    if sem_prev:
        print('sem previsão:', len(sem_prev), 'empreendimentos (array semPrevisao)')
    vendas_mercado = {_norm(nome): sorted(venda.items())
                      for nome, venda in ((h['empreendimento'], h['vend']) for h in hist.values())}
    mercado_emps = _montar_mercado(merc, emps, vendas_mercado)
    # mercadoMensal passa a derivar da série estendida (mesma janela e mesmos
    # números da curva com dimensões) — antes só ia até a data base e despencava.
    mercado_total = defaultdict(float)
    for e in mercado_emps:
        for x in e['mensal']:
            mercado_total[x['m']] += x['disp']
    # coordenadas do portal: lista de dicts {id_empreendimento, latitude, longitude}
    # (ordem já vem do SQL por Ordem) -> array [[id, [[lat,lng],...]], ...]
    coord = []
    if coordenadas:
        por_emp = {}
        for c in coordenadas:
            lat, lng = c.get('latitude'), c.get('longitude')
            if lat is None or lng is None:
                continue
            try:
                eid = int(float(c['id_empreendimento']))
                por_emp.setdefault(eid, []).append([round(float(lat), 8), round(float(lng), 8)])
            except (TypeError, ValueError, KeyError):
                continue
        coord = [[eid, verts] for eid, verts in sorted(por_emp.items())]
    data = {'geradoEm': datetime.date.today().isoformat(), 'fonte': fonte,
            'empreendimentos': list(emps.values()), 'historico': historico,
            'semPrevisao': sem_prev, 'mercado': mercado_emps,
            'portalCoordenadas': coord,
            'mercadoMensal': [[m, round(v, 1)] for m, v in sorted(mercado_total.items())]}
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


def gerar_de_dataframe(df, fonte, kmz_path=KMZ_PADRAO, sem_previsao=None, coordenadas=None):
    """Caminho usado pelo pipeline: master em memória, sem passar por Excel."""
    gerar_dados(list(df.columns), df.itertuples(index=False, name=None), fonte,
                sem_previsao=sem_previsao, coordenadas=coordenadas)
    gerar_mapa(kmz_path)


if __name__ == '__main__':
    raise SystemExit(
        'preprocess.py é uma biblioteca do pipeline, não um script.\n'
        'Para regenerar os data/*.js rode: python scripts/pipeline_of.py'
    )
