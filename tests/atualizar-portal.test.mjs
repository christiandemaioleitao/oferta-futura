import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Importa como ESM sem alterar o tipo do pacote usado pelas outras funções Vercel.
const source = await readFile(new URL('../api/atualizar-portal.js', import.meta.url), 'utf8');
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const run = { id: 123, status: 'completed', conclusion: 'success', path: '.github/workflows/pipeline-of.yml', head_branch: 'main' };

test('atualização autenticada e acompanhamento do pipeline', async t => {
  const originalFetch = globalThis.fetch;
  const oldSenha = process.env.SINTESE_UPLOAD_SENHA, oldToken = process.env.GITHUB_ACTIONS_TOKEN;
  process.env.SINTESE_UPLOAD_SENHA = 'senha-teste';
  process.env.GITHUB_ACTIONS_TOKEN = 'token-somente-servidor';
  const calls = [];
  let responses = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'chamada inesperada ao GitHub');
    if (next instanceof Response) return next;
    return { ok: true, status: 200, json: async () => next };
  };
  async function request(body = {}, method = 'POST') {
    const res = {
      headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(n) { this.code = n; return this; },
      json(data) { this.body = data; return this; }, end() { return this; },
    };
    calls.length = 0;
    await handler({ method, headers: { origin: 'https://oferta-futura.vercel.app' }, body: { senha: 'senha-teste', ...body } }, res);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.ok(!JSON.stringify(res.body || {}).includes('token-somente-servidor'));
    return res;
  }
  try {
    await t.test('OPTIONS e GET não executam o workflow', async () => {
      assert.equal((await request({}, 'OPTIONS')).code, 204);
      assert.equal((await request({}, 'GET')).code, 405);
      assert.equal(calls.length, 0);
    });
    await t.test('recusa senha incorreta e configuração ausente', async () => {
      assert.equal((await request({ senha: 'errada', action: 'iniciar' })).code, 401);
      assert.equal(calls.length, 0);
      delete process.env.GITHUB_ACTIONS_TOKEN;
      assert.equal((await request({ action: 'iniciar' })).code, 503);
      process.env.GITHUB_ACTIONS_TOKEN = 'token-somente-servidor';
    });
    await t.test('valida ação e ID antes de consultar GitHub', async () => {
      assert.equal((await request({ action: 'apagar' })).code, 400);
      assert.equal((await request({ action: 'status', id: '../secrets' })).code, 400);
      assert.equal(calls.length, 0);
    });
    await t.test('inicia somente o workflow fixo no main, preservando parâmetros', async () => {
      responses = [{ workflow_runs: [run] }, { workflow_run_id: 456 }];
      const res = await request({ action: 'iniciar', ref: 'outra', inputs: { ignorar_queda: true } });
      assert.equal(res.code, 202);
      assert.equal(res.body.run.id, 456);
      assert.equal(calls.length, 2);
      assert.match(calls[1].url, /actions\/workflows\/pipeline-of.yml\/dispatches$/);
      assert.deepEqual(JSON.parse(calls[1].opts.body), { ref: 'main', inputs: { manter_parametros: true } });
      assert.equal(calls[1].opts.headers.Authorization, 'Bearer token-somente-servidor');
    });
    await t.test('reaproveita execução ativa sem disparar outra', async () => {
      for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
        responses = [{ workflow_runs: [{ ...run, status, conclusion: null }] }];
        const res = await request({ action: 'iniciar' });
        assert.equal(res.code, 200);
        assert.equal(res.body.existente, true);
        assert.equal(calls.length, 1);
      }
    });
    await t.test('acompanha sucesso e falha sem expor o payload privado', async () => {
      for (const conclusion of ['success', 'failure', 'cancelled']) {
        responses = [{ ...run, conclusion, repository: { private: true } }];
        const res = await request({ action: 'status', id: 123 });
        assert.deepEqual(res.body, { run: { id: 123, status: 'completed', conclusion } });
      }
    });
    await t.test('recusa execuções de outro workflow ou branch', async () => {
      for (const patch of [{ path: '.github/workflows/upload-sintese.yml' }, { head_branch: 'outra' }]) {
        responses = [{ ...run, ...patch }];
        assert.equal((await request({ action: 'status', id: 123 })).code, 404);
      }
    });
    await t.test('devolve erro legível em timeout', async () => {
      responses = [new DOMException('timeout', 'TimeoutError')];
      const res = await request({ action: 'iniciar' });
      assert.equal(res.code, 502);
      assert.match(res.body.error, /Verifique o andamento/);
    });
    await t.test('não expõe corpo de erro privado do GitHub', async () => {
      responses = [new Response('detalhes privados do repositório', { status: 403 })];
      const res = await request({ action: 'iniciar' });
      assert.equal(res.code, 502);
      assert.match(res.body.error, /HTTP 403/);
      assert.ok(!JSON.stringify(res.body).includes('detalhes privados'));
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldSenha === undefined) delete process.env.SINTESE_UPLOAD_SENHA; else process.env.SINTESE_UPLOAD_SENHA = oldSenha;
    if (oldToken === undefined) delete process.env.GITHUB_ACTIONS_TOKEN; else process.env.GITHUB_ACTIONS_TOKEN = oldToken;
  }
});
