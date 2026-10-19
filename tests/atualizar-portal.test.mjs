import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/atualizar-portal.js';

const env = { SINTESE_UPLOAD_SENHA: 'senha-teste', PORTAL_GITHUB_TOKEN: 'token-servidor', DATABASE_URL: 'db-teste' };
const requestId = '33333333-3333-4333-8333-333333333333';
function setup({ vars = {}, runs = [], dbRows, ghStatus = 200, dbError } = {}) {
  const calls = [];
  const handler = createHandler({
    env: { ...env, ...vars },
    sqlFactory: () => async () => {
      calls.push({ db: true });
      if (dbError) throw new Error(dbError);
      return dbRows ?? [{ valor: 'base 03/2026 | janela 03/2026-09/2027 | fator 1.2' }];
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (ghStatus !== 200) return new Response('{}', { status: ghStatus });
      return options.method === 'POST' ? new Response(null, { status: 204 })
        : Response.json({ workflow_runs: runs });
    },
  });
  async function invoke(body = {}, method = 'POST') {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    return handler({ method, body: { senha: env.SINTESE_UPLOAD_SENHA, action: 'start', ...body } }, res);
  }
  return { calls, invoke };
}

test('recusa métodos e senhas inválidas antes de consultar qualquer serviço', async () => {
  const s = setup();
  assert.equal((await s.invoke({}, 'GET')).code, 405);
  assert.equal((await s.invoke({ senha: 'incorreta' })).code, 401);
  assert.deepEqual(s.calls, []);
});
test('recusa ação desconhecida e identificador inválido sem consultar GitHub', async () => {
  const s = setup();
  assert.equal((await s.invoke({ action: 'delete' })).code, 400);
  assert.equal((await s.invoke({ action: 'status', requestId: '../secrets' })).code, 400);
  assert.deepEqual(s.calls, []);
});
test('informa configuração ausente sem iniciar o pipeline', async () => {
  for (const key of Object.keys(env)) {
    const s = setup({ vars: { [key]: '' } });
    const r = await s.invoke();
    assert.equal(r.code, 503);
    assert.deepEqual(s.calls, []);
  }
});
test('dispara na main com os parâmetros anteriores e a guarda de queda ativa', async () => {
  const s = setup(); const r = await s.invoke();
  assert.equal(r.code, 202);
  assert.match(r.body.requestId, /^[a-f0-9-]{36}$/);
  const dispatch = s.calls.find(c => c.options?.method === 'POST');
  assert.equal(dispatch.url, 'https://api.github.com/repos/christiandemaioleitao/oferta-futura/actions/workflows/pipeline-of.yml/dispatches');
  assert.deepEqual(JSON.parse(dispatch.options.body), { ref: 'main', inputs: {
    data_base: '03/2026', fator_ajuste: '1.2', ignorar_queda: 'false', request_id: r.body.requestId,
  } });
  assert.ok(!JSON.stringify(r.body).includes(env.PORTAL_GITHUB_TOKEN));
  assert.equal(r.headers['Cache-Control'], 'no-store');
});
test('não troca parâmetros ausentes ou inválidos por valores padrão', async () => {
  for (const valor of [null, 'base 13/2026 | janela x | fator 1', 'base 01/2026 | janela x | fator 0']) {
    const s = setup({ dbRows: valor ? [{ valor }] : [] });
    assert.equal((await s.invoke()).code, 409);
    assert.equal(s.calls.filter(c => c.url).length, 0);
  }
});
test('bloqueia outro disparo enquanto há execução ativa', async () => {
  for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
    const s = setup({ runs: [{ status }] });
    assert.equal((await s.invoke()).code, 409);
    assert.ok(!s.calls.some(c => c.options?.method === 'POST'));
  }
});
test('acompanha a solicitação correta entre execuções concorrentes e antigas', async () => {
  const s = setup({ runs: [
    { display_title: 'Pipeline Oferta Futura', status: 'completed', conclusion: 'failure' },
    { display_title: `Portal: ${requestId}`, status: 'in_progress', conclusion: null, html_url: 'https://github.com/run/123' },
  ] });
  const r = await s.invoke({ action: 'status', requestId });
  assert.deepEqual(r.body, { status: 'in_progress', conclusion: null, url: 'https://github.com/run/123' });
  assert.ok(!s.calls.some(c => c.db || c.options?.method === 'POST'));
});
test('trata a demora do GitHub em listar a execução como solicitada', async () => {
  const r = await setup().invoke({ action: 'status', requestId });
  assert.deepEqual(r.body, { status: 'requested', conclusion: null });
});
test('informa falha do pipeline em vez de apresentar sucesso', async () => {
  const s = setup({ runs: [{ display_title: `Portal: ${requestId}`, status: 'completed', conclusion: 'failure' }] });
  const r = await s.invoke({ action: 'status', requestId });
  assert.equal(r.body.conclusion, 'failure');
});
test('não revela erros internos do banco ou detalhes da credencial', async () => {
  const r = await setup({ dbError: 'erro: senha-do-banco-secreta' }).invoke();
  assert.equal(r.code, 502);
  assert.ok(!JSON.stringify(r.body).includes('senha-do-banco-secreta'));
});
test('explica falta de acesso ao GitHub sem retornar headers ou token', async () => {
  for (const ghStatus of [401, 403, 404, 429]) {
    const r = await setup({ ghStatus }).invoke();
    assert.equal(r.code, 502);
    assert.ok(!JSON.stringify(r.body).includes(env.PORTAL_GITHUB_TOKEN));
  }
});
