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
const ctx = vm.runInNewContext(`${snippet}\n({ textKey, bairroKey, terrenoQuadraDe, terrenoLotesDe, terrenoQuadraEq, terrenoLev, terrenoBairroCasa, terrenoIndexar, terrenoConsultar })`, {});
const { bairroKey, terrenoQuadraDe, terrenoLotesDe, terrenoQuadraEq, terrenoLev, terrenoBairroCasa, terrenoIndexar, terrenoConsultar } = ctx;
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
test('quadra: zero à esquerda da IA ("08") casa com a base ("8") e vice-versa', () => {
  assert.ok(terrenoQuadraEq('08', '8'));
  assert.ok(terrenoQuadraEq('8', '08'));
  assert.ok(terrenoQuadraEq('008', '8'));
  assert.ok(terrenoQuadraEq('B-01', 'B-01'));
  assert.ok(!terrenoQuadraEq('B-01', 'B-1'));
  assert.ok(!terrenoQuadraEq('252', '244'));
});
test('bairro por tokens em todos os campos: "Solar Bougainville" acha PORTO BOUGAINVILLE (nome), não só bairro', () => {
  const base = [
    [444, [[-16.70, -49.37]], 'PORTO BOUGAINVILLE II - VILA BRASIL', 'FAZENDA SÃO JOSE', '33801805000000', ''],
    [446, [[-16.71, -49.37]], 'PORTO BOUGAINVILLE 1', 'FAZENDA SÃO JOSE', '33801804000000', ''],
    [232, [[-16.72, -49.35]], 'QD 8, RESIDENCIAL FLORIDA - VEGA', 'RESIDENCIAL FLORIDA', '33800001000000', ''],
  ];
  const idx = terrenoIndexar(base);
  const bk = bairroKey('Solar Bougainville');
  // casamento por token do nome do loteamento em TODOS os campos (aqui, o nome do portal)
  assert.deepEqual(ids(terrenoConsultar(idx, { bairro: bk })), [444, 446]);
  // "solar bougainville quadra 8 lote 44": quadra/lote não existem no portal para esses
  // registros — quadra 8 só casa FLORIDA (e bougainville não), então a consulta estrita
  // dá vazio e a IA cai para só-bairro no front
  assert.deepEqual(ids(terrenoConsultar(idx, { bairro: bk, quadra: '08', lote: '44' })), []);
  // só quadra 8 (sem bairro) casa o FLORIDA
  assert.deepEqual(ids(terrenoConsultar(idx, { quadra: '8' })), [232]);
});
test('bairro por grafia errada: "bouganville" casa "BOUGAINVILLE" por similaridade', () => {
  const base = [
    [446, [[-16.71, -49.37]], 'PORTO BOUGAINVILLE 1', 'FAZENDA SÃO JOSE', '33801804000000', ''],
  ];
  const idx = terrenoIndexar(base);
  const bk = bairroKey('qd 8 lote 44 bouganville'.replace(/qd\s*8\s*lote\s*44\s*/i, ''));
  assert.ok(idx.bairros.size === 1);   // FAZENDA SÃO JOSE indexada
  assert.deepEqual(ids(terrenoConsultar(idx, { bairro: bk })), [446]);
  assert.ok(terrenoBairroCasa(idx.entries[0], 'BOUGANVILLE'));
  assert.ok(terrenoBairroCasa(idx.entries[0], 'SOLAR BOUGANVILLE'));
  // grafia muito distante não casa
  assert.ok(!terrenoBairroCasa(idx.entries[0], 'MARISTA'));
});
