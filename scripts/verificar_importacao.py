"""Auditoria somente leitura: compara o arquivo publicado com o Neon via /api/sql.

Uso: python scripts/verificar_importacao.py --saida relatorio.json
Não executa o pipeline nem altera tabelas. A fonte SQL Server não é acessada.
"""
import argparse
import json
import math
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def auditar(url):
    url = url.rstrip('/')
    checks = []

    def get(path, body=None):
        headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-cache'}
        if os.environ.get('SG_SESSION_COOKIE'):
            headers['Cookie'] = os.environ['SG_SESSION_COOKIE']
        req = Request(url + path, data=json.dumps(body).encode() if body else None,
                      headers=headers)
        try:
            with urlopen(req, timeout=60) as response:
                return response.read().decode('utf-8')
        except HTTPError as err:
            if err.code == 401:
                raise SystemExit('Sessão SG necessária. Informe um cookie de sessão válido em SG_SESSION_COOKIE, sem versioná-lo ou compartilhá-lo.') from None
            raise

    def sql(query):
        result = json.loads(get('/api/sql', {'sql': query}))
        if result.get('error') or result.get('truncated'):
            raise RuntimeError(result.get('error') or 'Consulta truncada: auditoria incompleta')
        return result['rows']

    def pages(query):
        rows = []
        while True:
            page = sql(f'{query} LIMIT 200 OFFSET {len(rows)}')
            rows.extend(page)
            if len(page) < 200:
                return rows

    def check(name, ok, detail):
        checks.append({'teste': name, 'aprovado': bool(ok), 'detalhe': detail})
        print(f'{"OK" if ok else "FALHA"}: {name}', flush=True)

    def equal(expected, actual):
        if isinstance(expected, bool):
            return expected == (str(actual).strip().lower() in ('true', '1', 'sim'))
        if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
            return math.isclose(expected, actual, abs_tol=0.000001, rel_tol=0)
        if isinstance(actual, str):
            actual = actual.replace('_x000D_', '').strip()
            if actual in ('', '-', 'nan', 'None'):
                actual = None
        return expected == actual

    source = get('/data/dados_of.js?v=auditoria-' + str(datetime.now(timezone.utc).timestamp()))
    data = json.loads(source.removeprefix('window.OF_DATA=').strip().removesuffix(';'))
    meta = {row['chave']: row for row in sql('SELECT chave, valor, atualizado_em FROM of_meta')}
    counts = sql('SELECT count(*) AS linhas, count(DISTINCT id_empreendimento) AS empreendimentos '
                 'FROM projecao_of')[0]
    check('Contagem da master e metadados',
          int(counts['linhas']) == int(meta['projecao_linhas']['valor']) and int(counts['empreendimentos']) == int(meta['projecao_empreendimentos']['valor']), counts)
    emps = {str(e['id']): e for e in data['empreendimentos']}
    attrs = {
        'empreendimento': 'empreendimento', 'cidade': 'cidade', 'uf': 'Cidade.Uf', 'bairro': 'bairro',
        'incorporadora': 'incorporadora', 'tipo': 'TipoEmpreendimento', 'macrozona': 'macrozona',
        'lat': 'Latitude', 'lng': 'Longitude', 'logradouro': 'Logradouro', 'complemento': 'Complemento',
        'areaTerreno': 'AreaTerreno', 'totalUnidades': 'TotalUnidades', 'dtLancamento': 'dtlançamento',
        'descPavimentos': 'descPavimentos', 'adensamento': 'Adensamento', 'mcmv': 'MCMV',
        'observacao': 'Observacao', 'terrenoTapumado': 'TerrenoTapumado',
        'projetoProtocolado': 'ProjetoProtocolado', 'projetoAprovado': 'ProjetoAprovado',
        'idProtocolo': 'IdProtocoloProjeto', 'dataProtocolo': 'DataProtocoloProjeto',
        'dataAprovacao': 'DataAprovacao', 'linkProjeto': 'LinkDoProjeto', 'linkPortal': 'LinkPortal',
        'fonteEmpreendimento': 'FonteEmpreendimento', 'fonteDataLancamento': 'FonteDataLancamento',
        'fonteTipologia': 'FonteTipologia', 'fontePrevisao': 'FonteDataPrevisaoLancamento',
        'cluster': 'cluster', 'consideracaoOF': 'consideracao_OF',
    }
    columns = ', '.join(f'"{col}" AS "{key}"' for key, col in attrs.items())
    columns = columns.replace('"dtlançamento" AS "dtLancamento"', 'to_char("dtlançamento", \'YYYY-MM-DD\') AS "dtLancamento"')
    rows = pages(f'SELECT DISTINCT ON (id_empreendimento) id_empreendimento::bigint::text AS id, {columns} '
                 'FROM projecao_of WHERE id_empreendimento IS NOT NULL ORDER BY id_empreendimento, data, id_tipologia')
    check('Empreendimentos: mesmos IDs no banco e no dashboard', set(emps) == {r['id'] for r in rows}, {'dashboard': len(emps), 'banco': len(rows)})
    diffs = []
    for row in rows:
        for key in attrs:
            expected = emps.get(row['id'], {}).get(key)
            if not equal(expected, row[key]):
                diffs.append({'id': row['id'], 'campo': key, 'dashboard': expected, 'banco': row[key]})
    check('Campos cadastrais: nomes, datas, coordenadas, fontes e indicadores', not diffs,
          {'campos_comparados': len(rows) * len(attrs), 'divergencias': len(diffs), 'exemplos': diffs[:10]})

    tips = pages('SELECT DISTINCT id_empreendimento::bigint::text AS id, id_tipologia, '
                 'tipologia, tipologia_tratada AS tratada, "Unids_tipologia" AS unids, "AreaPrivativa" AS area '
                 'FROM projecao_of WHERE id_empreendimento IS NOT NULL ORDER BY id, id_tipologia')
    by_emp = defaultdict(list)
    for row in tips:
        by_emp[row['id']].append({k: row[k] for k in ('tipologia', 'tratada', 'unids', 'area')})
    def canon(items):
        # Postgres pode serializar 2.0 como 2; a comparação é numérica, sem perder duplicatas.
        return sorted(json.dumps({k: (str(v).strip() if k == 'tipologia' and v is not None else float(v) if v is not None else None)
                                  for k, v in t.items()}, sort_keys=True, ensure_ascii=False) for t in items)
    tip_diffs = [eid for eid, emp in emps.items() if canon(emp.get('tipologias', [])) != canon(by_emp[eid])]
    check('Tipologias: quantidade, quartos, unidades e área privativa', not tip_diffs,
          {'tipologias_banco': len(tips), 'tipologias_dashboard': sum(len(e.get('tipologias', [])) for e in emps.values()), 'ids_divergentes': tip_diffs})

    groups = pages('SELECT id_empreendimento::bigint::text AS id, to_char(data, \'YYYY-MM\') AS mes, '
                   'sum(unidadesdisponiveis) AS disp, sum(unidadesvendidasmes) AS vend, sum(unidadesdistratadasmes) AS distr '
                   'FROM projecao_of WHERE id_empreendimento IS NOT NULL GROUP BY id_empreendimento, data ORDER BY id, mes')
    monthly = {(eid, m['m']): m for eid, emp in emps.items() for m in emp.get('mensal', [])}
    month_diffs = []
    for row in groups:
        published = monthly.get((row['id'], row['mes']), {})
        for key, digits in [('disp', 1), ('vend', 2), ('distr', 2)]:
            value = round(row[key] or 0, digits)
            if not equal(published.get(key), value):
                month_diffs.append({'id': row['id'], 'mes': row['mes'], 'campo': key, 'dashboard': published.get(key), 'banco': value})
    check('Séries mensais: estoque, vendas e distratos por empreendimento', not month_diffs and len(monthly) == len(groups),
          {'meses_por_empreendimento': len(groups), 'valores_comparados': len(groups) * 3, 'divergencias': len(month_diffs), 'exemplos': month_diffs[:10]})
    split_diffs = []
    for eid, emp in emps.items():
        for m in emp.get('mensal', []):
            for key in ('tip', 'fx', 'tf'):
                if abs(sum(m.get(key, {}).values()) - m['disp']) > 0.11:
                    split_diffs.append({'id': eid, 'mes': m['m'], 'quebra': key})
    check('Quebras por quartos e área somam o estoque total', not split_diffs,
          {'divergencias': len(split_diffs), 'exemplos': split_diffs[:10]})

    market = pages('SELECT to_char(data, \'YYYY-MM\') AS mes, sum(unidadesdisponiveis) AS disp '
                   'FROM projecao_of WHERE id_empreendimento IS NULL GROUP BY data ORDER BY mes')
    published_market = dict(data['mercadoMensal'])
    # Ordem da soma em SQL e Python pode mudar a última casa binária em empates (.05).
    market_diffs = [r for r in market if r['mes'] not in published_market or abs(published_market[r['mes']] - (r['disp'] or 0)) > 0.050001]
    check('Mercado: estoque mensal da master corresponde ao arquivo', not market_diffs and len(market) == len(published_market),
          {'meses': len(market), 'divergencias': len(market_diffs), 'exemplos': market_diffs[:10]})

    no_date = pages('SELECT id::text, empreendimento, incorporadora, bairro, cidade, lat, lng '
                    'FROM "empreendimentos-sem-previsão-lançamento" ORDER BY id')
    published_no_date = {e['id'].removeprefix('sd-'): e for e in data['semPrevisao']}
    no_date_diffs = [r['id'] for r in no_date if any(not equal(published_no_date.get(r['id'], {}).get(k), v) for k, v in r.items() if k != 'id')]
    check('Sem previsão: IDs, nomes, localização e contagem', not no_date_diffs and set(published_no_date) == {r['id'] for r in no_date} and len(no_date) == int(meta['sem_previsao_linhas']['valor']),
          {'dashboard': len(published_no_date), 'banco': len(no_date), 'ids_divergentes': no_date_diffs})
    raw = sql('SELECT count(*) AS linhas, min(data) AS primeiro_mes, max(data) AS ultimo_mes FROM sintese_consolidada')[0]
    check('Síntese bruta: contagem importada corresponde aos metadados', int(raw['linhas']) == int(meta['sintese_linhas']['valor']), raw)
    projected_at = meta['projecao_parametros']['atualizado_em']
    raw_at = meta['sintese_linhas']['atualizado_em']
    check('Projeção recalculada após o último upload da síntese', projected_at >= raw_at,
          {'projecao_em': projected_at, 'sintese_em': raw_at, 'arquivo': meta['sintese_arquivo']['valor']})
    return {'executado_em': datetime.now(timezone.utc).isoformat(), 'site': url,
            'dashboard_gerado_em': data['geradoEm'], 'parametros': meta['projecao_parametros']['valor'],
            'escopo': 'Consistência entre Neon e arquivo publicado. Sem acesso direto à fonte SQL Server.',
            'testes': checks, 'aprovados': sum(c['aprovado'] for c in checks), 'total': len(checks)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='https://oferta-futura.vercel.app')
    parser.add_argument('--saida', type=Path, required=True)
    args = parser.parse_args()
    report = auditar(args.url)
    args.saida.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    raise SystemExit(0 if report['aprovados'] == report['total'] else 1)
