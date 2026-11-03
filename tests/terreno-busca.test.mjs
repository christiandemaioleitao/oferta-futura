import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
/* extração: linha do textKey + bloco bairroKey + seção da busca de terrenos
   (helpers puros — sem Leaflet, sem DOM) */
const linhaTextKey = source.match(/^const textKey = .*$/m)[0];
const bkStart = source.indexOf('const BAIRRO_STOP');
const bkEnd = source.indexOf('let bairroRenderer');
const secStart = source.indexOf('const TERRENO_QD_RE');
const secEnd = source.indexOf('let tsLayer = null');
const snippet = [linhaTextKey, source.slice(bkStart, bkEnd), source.slice(secStart, secEnd)].join('\n');
const ctx = vm.runInNewContext(`${snippet}\n({ textKey, bairroKey, terrenoQuadraDe, terrenoLotesDe, terrenoIndexar, terrenoConsultar })`, {});
const { bairroKey, terrenoQuadraDe, terrenoLotesDe, terrenoIndexar, terrenoConsultar } = ctx;
/* arrays vindos do realm do vm não passam em deepEqual: convertemos com Array.from */
const ids = (res) => Array.from(res, e => e.rec[0]);
const lotes = (res) => Array.from(res);

test('quadra vem do nome do portal ("QD 252, MARISTA - TOP")', () => {
  assert.equal(terrenoQuadraDe('QD 252, MARISTA - TOP', ''), '252');
});
test('quadra alfanumérica e com hífen', () => {
  assert.equal(terrenoQuadraDe('QD G12, MARISTA - DINAMICA', ''), 'G12');
  assert.equal(terrenoQuadraDe('QD B-01 (LOTE AREA), VI ABAJA - TENDA', ''), 'B-01');
});
test('quadra vem do complemento quando o nome não cita ("Quadra ÁREA")', () => {
  assert.equal(terrenoQuadraDe('RESIDENCIAL X', 'Quadra ÁREA, Lote AREA04, Setor FAZ CAVEIRAS - MRV'), 'AREA');
  assert.equal(terrenoQuadraDe('', 'Qd. 252 Setor Marista'), '252');
});
test('lotes do complemento: lista com vírgulas e "e"', () => {
  assert.deepEqual(lotes(terrenoLotesDe('Qd. 04, Setor Coimbra, Lotes 3, 5, 7, 9 e 82')), ['3', '5', '7', '9', '82']);
  assert.deepEqual(lotes(terrenoLotesDe('Quadra AREA Lote 01, Setor CH SANTA RITA')), ['01']);
  assert.deepEqual(lotes(terrenoLotesDe('Avenida 85 c/ Rua 143')), []);
});
test('índice monta cascata bairro → quadras/lotes e tolera registro de 4 posições', () => {
  const base = [
    [28, [[-16.7, -49.25]], 'QD 252, MARISTA - TOP', 'MARISTA', '123456', 'Qd. 252 Setor Marista'],
    [751, [[-16.7, -49.27]], 'QD 550, JARDIM AMÉRICA - GPE', 'JARDIM AMERICA'],
    [1951, [[-16.69, -49.25]], 'QD 244, MARISTA - CITY', 'MARISTA', '', 'Lotes 3, 5'],
  ];
  const idx = terrenoIndexar(base);
  assert.equal(idx.entries.length, 3);
  const marista = idx.bairros.get(bairroKey('MARISTA'));
  assert.deepEqual([...marista.quadras].sort(), ['244', '252']);
  assert.deepEqual([...marista.lotes].sort(), ['3', '5']);
  // bairro normalizado (sem prefixo SETOR/JARDIM e sem acento)
  assert.ok(idx.bairros.has(bairroKey('JARDIM AMÉRICA')));
});
test('consulta por bairro, quadra e lote; IPTU por igualdade/inclusão', () => {
  const base = [
    [28, [[-16.7, -49.25]], 'QD 252, MARISTA - TOP', 'MARISTA', '123456', 'Qd. 252 Setor Marista'],
    [1951, [[-16.69, -49.25]], 'QD 244, MARISTA - CITY', 'MARISTA', '', 'Lotes 3, 5'],
    [751, [[-16.7, -49.27]], 'QD 550, JARDIM AMÉRICA - GPE', 'JARDIM AMERICA', '', ''],
  ];
  const idx = terrenoIndexar(base);
  const bk = bairroKey('MARISTA');
  assert.deepEqual(ids(terrenoConsultar(idx, { bairro: bk })), [28, 1951]);
  assert.deepEqual(ids(terrenoConsultar(idx, { bairro: bk, quadra: '244' })), [1951]);
  assert.deepEqual(ids(terrenoConsultar(idx, { bairro: bk, quadra: '244', lote: '3' })), [1951]);
  assert.deepEqual(ids(terrenoConsultar(idx, { bairro: bk, quadra: '244', lote: '99' })), []);
  assert.deepEqual(ids(terrenoConsultar(idx, { iptu: '123456' })), [28]);
  assert.deepEqual(ids(terrenoConsultar(idx, { iptu: '2345' })), [28]);
  // consulta vazia não casa nada
  assert.deepEqual(ids(terrenoConsultar(idx, {})), []);
  // quadra sem bairro casa em qualquer bairro
  assert.deepEqual(ids(terrenoConsultar(idx, { quadra: '550' })), [751]);
});
