import datetime
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import preprocess
from pipeline_of import aplicar_ajustes_finais


class DatasCardsTest(unittest.TestCase):
    def test_datas_percorrem_master_e_terrenos_sem_previsao_ate_json(self):
        dates = {
            'DataProtocoloProjeto': 'dataProtocolo',
            'DataAprovacao': 'dataAprovacao',
            'DataProtocoloProjetoOutros': 'dataProtocoloOutros',
            'DataRemembramentoDesmembramento': 'dataRemembramento',
        }
        row = {'id_empreendimento': 1, 'id_tipologia': 10, 'empreendimento': 'Terreno teste',
               **{field: '2026-10-28 08:30:00' for field in dates}}
        df = aplicar_ajustes_finais(pd.DataFrame([row]))
        without_dates = {key: None for key in dates.values()}
        no_launch = {'id': 2, **{field: datetime.datetime(2026, 10, 28) for field in
                     ['data_protocolo', 'data_aprovacao', 'data_protocolo_outros', 'data_remembramento']}}
        with tempfile.TemporaryDirectory() as folder, patch.object(preprocess, 'BASE', folder):
            (Path(folder) / 'data').mkdir()
            preprocess.gerar_dados(list(df.columns), df.itertuples(index=False, name=None),
                                  'teste', sem_previsao=[no_launch, {'id': 3}])
            content = (Path(folder) / 'data/dados_of.js').read_text(encoding='utf-8')
            data = json.loads(content.removeprefix('window.OF_DATA=').removesuffix(';'))
        for field in dates.values():
            self.assertEqual(data['empreendimentos'][0][field], '2026-10-28')
            self.assertEqual(data['semPrevisao'][0][field], '2026-10-28')
        self.assertEqual({field: data['semPrevisao'][1][field] for field in dates.values()}, without_dates)


if __name__ == '__main__':
    unittest.main()
