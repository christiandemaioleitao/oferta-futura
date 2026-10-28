import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const helper = source.match(/function tagsProjeto\(e\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(helper, 'Classificação dos cards precisa existir.');
const tagsProjeto = vm.runInNewContext(`(${helper})`);

test('tags dos cards seguem as datas e a precedência dos quatro estágios', () => {
  const fields = ['dataProtocoloOutros', 'dataRemembramento', 'dataProtocolo', 'dataAprovacao'];
  const expected = [
    '', 'Alvará de demolição', 'Remembrado', 'Remembrado',
    'Projeto Protocolado', 'Projeto Protocolado', 'Projeto Protocolado', 'Projeto Protocolado',
    ...Array(8).fill('Projeto Aprovado'),
  ];
  for (let mask = 0; mask < 16; mask++) {
    const e = Object.fromEntries(fields.map((field, i) => [field, mask & (1 << i) ? '2026-10-28' : null]));
    assert.equal(tagsProjeto(e).join('|'), expected[mask], JSON.stringify(e));
  }
  assert.equal(tagsProjeto({ projetoProtocolado: true, projetoAprovado: true }).length, 0);
  assert.equal(tagsProjeto(Object.fromEntries(fields.map(field => [field, '']))).length, 0);
});
