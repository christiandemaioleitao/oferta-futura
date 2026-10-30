"""A curva do mercado (síntese) precisa sobreviver ao fim da data base.

A síntese só publica estoque até o mês base; sem a extensão, o gráfico de
estoque despencava (ex.: ~10,9 mil un em jun/26 -> 149 em jul/26) porque a base
do mercado sumia do dia para a noite enquanto a projeção seguia.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import preprocess

COLUNAS = ['id_empreendimento', 'id_tipologia', 'empreendimento', 'data',
           'unidadesdisponiveis', 'unidadesvendidasmes', 'unidadesdistratadasmes',
           'incorporadora', 'bairro', 'TipoEmpreendimento', 'macrozona',
           'dtlançamento', 'AreaPrivativa', 'tipologia_tratada', 'tipologia',
           'TotalUnidades', 'Unids_tipologia', 'cluster']


def linha_mercado(mes, disp, vend, nome='MERCADO A', inc='INC A', total=600):
    return [None, None, nome, f'{mes}-15', disp, vend, 0, inc, 'BAIRRO X',
            'APART - ECO', 'Z1', '2020-01-01', 50, 2, '2Q', total, None, None]


def linha_projecao(mes, disp, nome='PROJ B'):
    return [1, 10, nome, f'{mes}-15', disp, 0, 0, 'INC B', 'BAIRRO Y',
            'APART - MAP', 'Z2', '2026-01-01', 50, 2, '2Q', 400, 400, None]


class MercadoCurvaTest(unittest.TestCase):
    def _gerar(self, linhas):
        with tempfile.TemporaryDirectory() as folder, patch.object(preprocess, 'BASE', folder):
            (Path(folder) / 'data').mkdir()
            preprocess.gerar_dados(COLUNAS, [tuple(l) for l in linhas], 'teste')
            conteudo = (Path(folder) / 'data/dados_of.js').read_text(encoding='utf-8')
        return json.loads(conteudo.removeprefix('window.OF_DATA=').removesuffix(';'))

    def test_curva_mercado_e_estendida_ate_a_janela_da_projecao(self):
        linhas = [linha_mercado(m, 600, 100) for i, m in
                  enumerate(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'])]
        linhas += [linha_projecao(m, 400) for m in ('2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09')]
        data = self._gerar(linhas)
        mensal = {x['m']: x['disp'] for x in data['mercado'][0]['mensal']}
        # síntese real até jun/26; dali em diante decai pelo ritmo de vendas (100/mês)
        self.assertEqual(mensal['2026-06'], 600)
        self.assertAlmostEqual(mensal['2026-07'], 500, places=1)
        self.assertAlmostEqual(mensal['2026-08'], 400, places=1)
        self.assertAlmostEqual(mensal['2026-09'], 300, places=1)
        # mercadoMensal derivado da série estendida: sem despenco em jul/26
        mm = dict(data['mercadoMensal'])
        self.assertGreater(mm['2026-07'], 400)

    def test_produto_com_vendas_irrelevantes_decai_pela_performance_do_mercado(self):
        """Regra nova: média de vendas < 1 un a cada 6 meses (< 1/6 un/mês) ->
        o estoque não fica constante; decai pela performance média do mercado."""
        linhas = [linha_mercado('2026-05', 200, 0, nome='MERCADO PARADO', inc='INC C')]
        linhas += [linha_projecao(m, 400) for m in ('2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09')]
        data = self._gerar(linhas)
        mensal = {x['m']: x['disp'] for x in data['mercado'][0]['mensal']}
        self.assertAlmostEqual(mensal['2026-05'], 200, places=1)
        # decaimento mensal pela fração do mercado: menor que o estoque original,
        # mas estritamente decrescente (não é mais constante)
        self.assertLess(mensal['2026-09'], 199)
        self.assertGreater(mensal['2026-09'], 150)

    def test_decaimento_do_mercado_usa_as_vendas_dos_outros_produtos(self):
        """A fração mensal do mercado = vendas dos últimos 6 meses ÷ (6 × estoque
        total da base). Com 100 un/mês vendidas e 600 em estoque: 1/36 ≈ 2,78%/mês."""
        linhas = [linha_mercado(m, 6000, 100, nome='MERCADO A', inc='INC A')
                  for m in ('2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06')]
        linhas += [linha_mercado('2026-05', 200, 0, nome='MERCADO PARADO', inc='INC C')]
        linhas += [linha_projecao(m, 400) for m in ('2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09')]
        data = self._gerar(linhas)
        por_nome = {x['empreendimento']: {y['m']: y['disp'] for y in x['mensal']} for x in data['mercado']}
        # MERCADO A tem vendas próprias (100/mês) — segue o decaimento linear antigo
        self.assertAlmostEqual(por_nome['MERCADO A']['2026-09'], 5700, places=1)
        # MERCADO PARADO decai pela fração do mercado: 200 × (59/60)^4 ≈ 194,7
        self.assertAlmostEqual(por_nome['MERCADO PARADO']['2026-09'], 200 * (1 - 100 / 6200) ** 4, places=1)

    def test_previstos_seguem_a_curva_de_absorcao_da_tipologia(self):
        """Cohort de 36 meses: produto 2Q lançado há 12 meses vendeu 60% nos 6
        primeiros meses; o previsto de 2Q recebe essa mesma curva de vendas."""
        def linha_lancado(mes, disp, vend, nome='MERCADO LANÇADO'):
            return [None, None, nome, f'{mes}-15', disp, vend, 0, 'INC L', 'BAIRRO X',
                    'APART - ECO', 'Z1', '2025-06-01', 50, 2, '2Q', 600, None, None]
        linhas = []
        for i, m in enumerate(['2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11']):
            linhas.append(linha_lancado(m, 600 - 60 * i, 60))
        for i, m in enumerate(['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05']):
            linhas.append(linha_lancado(m, max(240 - 20 * i, 0), 20))
        # previsto: 2Q, 400 un, lançamento previsto em mai/26 (o emp usa o id 1
        # da linha_projecao; o dtLancamento da coluna 11 é que manda)
        linhas += [[1, 10, 'PROJ NOVO', '2026-04-15', 400, 0, 0, 'INC B', 'BAIRRO Y',
                    'APART - MAP', 'Z2', '2026-05-01', 50, 2, '2Q', 400, 400, None]]
        # meses restantes da janela (mesma id — só alimentam a série/meses da OF)
        linhas += [linha_projecao(m, 400) for m in ('2026-05', '2026-06', '2026-07', '2026-08', '2026-09')]
        data = self._gerar(linhas)
        emp = [e for e in data['empreendimentos'] if e['empreendimento'] == 'PROJ NOVO'][0]
        mensal = {x['m']: x['disp'] for x in emp['mensal']}
        # vida 0: tudo disponível; vida 4: 60% já vendida na curva do cohort (0.6*4/6)
        self.assertAlmostEqual(mensal['2026-05'], 400, places=1)
        self.assertAlmostEqual(mensal['2026-09'], 400 * (1 - 0.4), places=1)
        # quebra por tipologia acompanha o novo disponível
        tip09 = {x['m']: x['tip'] for x in emp['mensal']}['2026-09']
        self.assertAlmostEqual(tip09['2'], 240, places=1)

    def test_estoque_zera_quando_vendas_consumem_o_saldo(self):
        linhas = [linha_mercado('2026-06', 150, 100, nome='MERCADO FIM', inc='INC D')]
        linhas += [linha_projecao(m, 400) for m in ('2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09')]
        data = self._gerar(linhas)
        mensal = {x['m']: x['disp'] for x in data['mercado'][0]['mensal']}
        self.assertAlmostEqual(mensal['2026-07'], 50, places=1)
        self.assertNotIn('2026-09', mensal)  # 50 - 100 -> zera em ago/26

    def test_produto_tambem_na_projecao_nao_e_duplicado(self):
        linhas = [linha_mercado('2026-05', 300, 50, nome='PROJ B', inc='INC B')]
        linhas += [linha_projecao(m, 400) for m in ('2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09')]
        data = self._gerar(linhas)
        self.assertEqual(data['mercado'], [])  # saiu do mercado (evita dupla contagem)

    def test_coordenadas_do_portal_entram_agrupadas_no_dados_of(self):
        linhas = [linha_projecao(m, 400) for m in ('2026-04', '2026-05', '2026-06')]
        coords = [
            {'id_empreendimento': 9, 'latitude': -16.7, 'longitude': -49.27,
             'empreendimento': 'AMBIENTE TERRAL', 'bairro': 'BUENO'},
            {'id_empreendimento': 1952, 'latitude': -16.69717411, 'longitude': -49.26661233,
             'empreendimento': 'QD G19, MARISTA - DESCONHECIDA', 'bairro': 'MARISTA'},
            {'id_empreendimento': 1952, 'latitude': -16.69735140, 'longitude': -49.26684142,
             'empreendimento': 'QD G19, MARISTA - DESCONHECIDA', 'bairro': 'MARISTA'},
            {'id_empreendimento': 1952, 'latitude': -16.69717411, 'longitude': -49.26661233,
             'empreendimento': 'QD G19, MARISTA - DESCONHECIDA', 'bairro': 'MARISTA'},
        ]
        with tempfile.TemporaryDirectory() as folder, patch.object(preprocess, 'BASE', folder):
            (Path(folder) / 'data').mkdir()
            preprocess.gerar_dados(COLUNAS, [tuple(l) for l in linhas], 'teste',
                                   coordenadas=coords)
            conteudo = (Path(folder) / 'data/dados_of.js').read_text(encoding='utf-8')
        data = json.loads(conteudo.removeprefix('window.OF_DATA=').removesuffix(';'))
        pc = dict((r[0], r) for r in data['portalCoordenadas'])
        self.assertEqual(sorted(pc), [9, 1952])
        self.assertEqual(pc[9], [9, [[-16.7, -49.27]], 'AMBIENTE TERRAL', 'BUENO'])
        self.assertEqual(pc[1952], [1952, [[-16.69717411, -49.26661233],
                                           [-16.6973514, -49.26684142],
                                           [-16.69717411, -49.26661233]],
                                   'QD G19, MARISTA - DESCONHECIDA', 'MARISTA'])

    def test_sem_coordenadas_o_array_nasce_vazio(self):
        linhas = [linha_projecao(m, 400) for m in ('2026-04', '2026-05', '2026-06')]
        data = self._gerar(linhas)
        self.assertEqual(data['portalCoordenadas'], [])


if __name__ == '__main__':
    unittest.main()
