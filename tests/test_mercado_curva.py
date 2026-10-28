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

    def test_produto_sem_vendas_registradas_carrega_estoque_constante(self):
        linhas = [linha_mercado('2026-05', 200, 0, nome='MERCADO PARADO', inc='INC C')]
        linhas += [linha_projecao(m, 400) for m in ('2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09')]
        data = self._gerar(linhas)
        mensal = {x['m']: x['disp'] for x in data['mercado'][0]['mensal']}
        self.assertAlmostEqual(mensal['2026-05'], 200, places=1)
        self.assertAlmostEqual(mensal['2026-09'], 200, places=1)

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


if __name__ == '__main__':
    unittest.main()
