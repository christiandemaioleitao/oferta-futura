import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const start = source.indexOf('const portalCoordsVisiveis');
const end = source.indexOf('function renderMap()');
const snippet = source.slice(start, end);
const { portalCoordsVisiveis } = vm.runInNewContext(`${snippet}\n({ portalCoordsVisiveis })`, {});

const coords = [[9, [[-16.7, -49.27]]], [1952, [[-16.69, -49.26], [-16.69, -49.26]]], [9999, [[0, 0]]]];

test('sem filtro ativo mostra todas as coordenadas do portal', () => {
  assert.equal(portalCoordsVisiveis(coords, new Set(), false).length, 3);
});

test('com filtro ativo mostra só os empreendimentos filtrados (id como string)', () => {
  const ids = new Set(['9', '1952']); // front usa String(e.id)
  const visiveis = portalCoordsVisiveis(coords, ids, true).map(r => r[0]);
  assert.deepEqual(visiveis, [9, 1952]);
});

test('com filtro ativo, id fora do recorte sai da camada', () => {
  const visiveis = portalCoordsVisiveis(coords, new Set(['9']), true).map(r => r[0]);
  assert.deepEqual(visiveis, [9]);
});
