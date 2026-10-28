import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ xmlEsc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') });
vm.runInContext(readFileSync(new URL('../js/vendor/polygon-clipping-0.15.7.umd.min.js', import.meta.url), 'utf8'), context);
const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
vm.runInContext(source.slice(source.indexOf('function selectedLotsGeometry'), source.indexOf('async function downloadKmz')), context);
const { selectedLotsGeometry, selectedLotsKml } = context;
const box = (x, y, w = 1) => [[x, y], [x + w, y], [x + w, y + w], [x, y + w], [x, y]];
const lot = (...rings) => ({ attributes: { nm_lot: 'A&B <teste>' }, geometry: { rings } });
const area = ring => Math.abs(ring.slice(1).reduce((s, p, i) => s + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2);
const polygonArea = polygons => polygons.reduce((sum, rings) => sum + area(rings[0]) - rings.slice(1).reduce((s, r) => s + area(r), 0), 0);

test('KMZ une bordas contíguas e sobreposições sem duplicar área ou manter divisória', () => {
  for (const lots of [[lot(box(0, 0)), lot(box(1, 0))], [lot(box(0, 0, 2)), lot(box(1, 0, 2))]]) {
    const geometry = selectedLotsGeometry(lots);
    assert.equal(geometry.length, 1);
    assert.equal(polygonArea(geometry), lots[0].geometry.rings[0][1][0] === 1 ? 2 : 6);
    const { kml, count } = selectedLotsKml(lots);
    assert.equal(count, 1);
    assert.equal((kml.match(/<Placemark>/g) || []).length, 1);
    assert.ok(kml.includes('A&amp;B &lt;teste&gt;'));
  }
});

test('KMZ gera uma marcação para cada área separada e preserva buracos e ilhas', () => {
  const lots = [lot(box(0, 0, 4), box(1, 1, 2), box(1.5, 1.5)), lot(box(10, 10))];
  const geometry = selectedLotsGeometry(lots);
  assert.equal(geometry.length, 3);
  assert.equal(polygonArea(geometry), 14);
  const { kml, count } = selectedLotsKml(lots);
  assert.equal(count, 3);
  assert.equal((kml.match(/<Placemark>/g) || []).length, 3);
  assert.equal((kml.match(/<innerBoundaryIs>/g) || []).length, 1);
  for (const polygon of geometry) for (const ring of polygon) assert.deepEqual(ring[0], ring.at(-1));
});

test('exportação recusa seleção vazia ou geometrias inválidas sem omitir lotes', () => {
  assert.throws(() => selectedLotsGeometry([]), /Selecione/);
  for (const bad of [{}, lot([]), lot([[0, 0], [1, 0], [NaN, 1], [0, 0]]), lot(box(180, 0))]) {
    assert.throws(() => selectedLotsGeometry([lot(box(0, 0)), bad]), /geometria válida/);
  }
});
