import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const gynLoteKey'), source.indexOf('function renderMapTools'));
const { selectedLotsArea, rulerLength } = vm.runInNewContext(`${helpers}\n({selectedLotsArea, rulerLength})`, {
  map: { distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) },
});
const lot = area => ({ attributes: { 'shape.STArea()': area } });

test('área soma valores oficiais sem arredondar parcelas nem ocultar lotes sem área', () => {
  const lots = new Map([[790, lot(3328.55322265625)], [992, lot(3189.72998046875)]]);
  assert.equal(selectedLotsArea(lots), 6518.283203125);
  lots.set(790, lot(3328.55322265625));
  assert.equal(selectedLotsArea(lots), 6518.283203125);
  for (const invalid of [undefined, null, '500', NaN, Infinity, -1]) {
    lots.set(992, lot(invalid));
    assert.equal(selectedLotsArea(lots), null);
  }
});

test('régua acumula todos os trechos usando a distância do mapa', () => {
  assert.equal(rulerLength([]), 0);
  assert.equal(rulerLength([[0, 0]]), 0);
  assert.equal(rulerLength([[0, 0], [3, 4], [6, 0]]), 10);
});
