import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from pipeline_of import parametros_anteriores, mes_ano


class ParametrosPortalTest(unittest.TestCase):
    def test_preserva_periodo_e_fator(self):
        pg = MagicMock()
        cur = pg.cursor.return_value.__enter__.return_value
        cur.fetchone.return_value = ('base 03/2026 | janela 03/2026-09/2027 | fator 0.85',)
        base, fator = parametros_anteriores(pg)
        self.assertEqual(mes_ano(base).strftime('%Y-%m'), '2026-03')
        self.assertEqual(fator, 0.85)
        cur.execute.assert_called_once_with('SELECT valor FROM of_meta WHERE chave = %s', ('projecao_parametros',))

    def test_sem_metadados_aborta_em_vez_de_trocar_o_recorte(self):
        pg = MagicMock()
        cur = pg.cursor.return_value.__enter__.return_value
        for row in [None, ('',), ('base inválida',)]:
            with self.subTest(row=row):
                cur.fetchone.return_value = row
                with self.assertRaisesRegex(ValueError, 'Parâmetros anteriores'):
                    parametros_anteriores(pg)


if __name__ == '__main__':
    unittest.main()
