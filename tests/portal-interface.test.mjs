import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const init = source.slice(source.indexOf('function initPortalRefresh()'), source.indexOf('/* ---------- upload da síntese'));
function setup(respostas) {
  const button = {}, status = { append() {} };
  const calls = [], messages = [];
  let reloads = 0;
  Object.defineProperty(status, 'textContent', { set(v) { messages.push(v); }, get() { return messages.at(-1); } });
  const context = vm.createContext({
    $: s => s === '#atualizarPortalBtn' ? button : status,
    document: { createElement: () => ({}) },
    pedirSenha: () => 'senha-teste', senhaSessao: 'senha-teste',
    AbortSignal, Date, setTimeout: fn => fn(),
    location: { reload() { reloads++; } },
    fetch: async (url, opts) => {
      calls.push({ url, body: opts.body && JSON.parse(opts.body) });
      const next = respostas.shift();
      assert.ok(next, 'requisição inesperada');
      if (next instanceof Error) throw next;
      return { ok: next.code === undefined || next.code < 400, status: next.code || 200, json: async () => next.body || next };
    },
  });
  vm.runInContext(init + '\ninitPortalRefresh();', context);
  return { button, status, calls, messages, context, reloads: () => reloads };
}
const id = '33333333-3333-4333-8333-333333333333';
test('espera a execução E a publicação correta antes de recarregar', async () => {
  const s = setup([
    { requestId: id }, { status: 'queued' }, { status: 'in_progress' },
    { status: 'completed', conclusion: 'success' },
    { requestId: 'deploy-antigo' }, { requestId: id },
  ]);
  await s.button.onclick();
  assert.equal(s.reloads(), 1);
  assert.deepEqual(s.calls.filter(c => c.body).map(c => c.body.action), ['start', 'status', 'status', 'status']);
  assert.equal(s.calls.filter(c => c.url.startsWith('data/')).length, 2);
  assert.ok(s.messages.some(m => m.includes('na fila')));
  assert.ok(s.messages.some(m => m.includes('recalculando')));
  assert.ok(s.messages.some(m => m.includes('Aguardando a publicação')));
});
test('falha do pipeline não recarrega o site e permite tentar de novo', async () => {
  const s = setup([{ requestId: id }, { status: 'completed', conclusion: 'failure' }]);
  await s.button.onclick();
  assert.equal(s.reloads(), 0);
  assert.equal(s.button.disabled, false);
  assert.equal(s.button.textContent, 'Atualizar');
  assert.match(s.status.textContent, /não foi concluída/);
});
test('erro de rede no acompanhamento retoma sem duplicar o disparo', async () => {
  const s = setup([{ requestId: id }, new Error('rede indisponível')]);
  await s.button.onclick();
  assert.equal(s.button.textContent, 'Verificar');
  s.calls.length = 0;
  // A mesma função mantém o requestId quando o usuário tenta verificar novamente.
  // Outra falha encerra esta tentativa sem deixar um loop aberto no teste.
  s.context.fetch = async (url, opts) => { s.calls.push({ body: JSON.parse(opts.body) }); throw new Error('rede indisponível'); };
  await s.button.onclick();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].body.action, 'status');
  assert.equal(s.calls[0].body.requestId, id);
  assert.equal(s.reloads(), 0);
});
test('senha errada limpa a sessão e apresenta o erro do servidor', async () => {
  const s = setup([{ code: 401, body: { error: 'Senha incorreta.' } }]);
  await s.button.onclick();
  assert.equal(s.context.senhaSessao, '');
  assert.equal(s.status.textContent, 'Senha incorreta.');
  assert.equal(s.button.disabled, false);
});
