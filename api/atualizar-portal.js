// Dispara o pipeline existente; SQL Server e recálculo continuam no Actions.
// O token do GitHub fica exclusivamente no servidor, nunca no navegador/config.
import { neon } from '@neondatabase/serverless';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const REPO = 'christiandemaioleitao/oferta-futura';
const WORKFLOW = 'pipeline-of.yml';
const BRANCH = 'main';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ATIVOS = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
export const config = { maxDuration: 30 };

export function createHandler({ env = process.env, fetchImpl = fetch, sqlFactory = neon } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Allow', 'POST');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    const senha = env.SINTESE_UPLOAD_SENHA;
    if (!senha) return res.status(503).json({ error: 'Atualização desativada: configure SINTESE_UPLOAD_SENHA na Vercel.' });
    const body = req.body || {};
    const enviada = Buffer.from(String(body.senha || ''));
    const esperada = Buffer.from(senha);
    if (enviada.length !== esperada.length || !timingSafeEqual(enviada, esperada))
      return res.status(401).json({ error: 'Senha incorreta.' });
    if (!['start', 'status'].includes(body.action))
      return res.status(400).json({ error: 'Ação inválida.' });
    if (!env.PORTAL_GITHUB_TOKEN)
      return res.status(503).json({ error: 'Atualização desativada: configure PORTAL_GITHUB_TOKEN na Vercel (Actions: leitura e escrita neste repositório).' });

    async function github(path, options = {}) {
      const r = await fetchImpl(`https://api.github.com/repos/${REPO}/actions/${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${env.PORTAL_GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'oferta-futura',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error([401, 403, 404].includes(r.status)
        ? 'O servidor não tem acesso ao pipeline. Verifique PORTAL_GITHUB_TOKEN e suas permissões no GitHub.'
        : `O GitHub recusou a solicitação (HTTP ${r.status}). Tente novamente mais tarde.`);
      return r.status === 204 ? null : r.json();
    }

    try {
      if (body.action === 'status') {
        if (!UUID.test(String(body.requestId || ''))) return res.status(400).json({ error: 'Identificador de atualização inválido.' });
        // Consulta somente este workflow na main. O ID não permite consultar outra API.
        const result = await github(`workflows/${WORKFLOW}/runs?branch=${BRANCH}&event=workflow_dispatch&per_page=100`);
        const run = result.workflow_runs.find(r => r.display_title === `Portal: ${body.requestId}`);
        return res.status(200).json(run
          ? { status: run.status, conclusion: run.conclusion, url: run.html_url }
          : { status: 'requested', conclusion: null });
      }

      const db = env.DATABASE_URL || env.NEON_DATABASE_URL;
      if (!db) return res.status(503).json({ error: 'DATABASE_URL não configurada no servidor.' });
      // Reusa os parâmetros da última projeção, sem mudar silenciosamente a janela.
      const sql = sqlFactory(db);
      const rows = await sql("SELECT valor FROM of_meta WHERE chave = 'projecao_parametros'");
      const params = String(rows[0]?.valor || '').match(/^base (0[1-9]|1[0-2])\/(\d{4}) \| janela .* \| fator (\d+(?:\.\d+)?)$/);
      if (!params || !Number.isFinite(Number(params[3])) || Number(params[3]) <= 0)
        return res.status(409).json({ error: 'Parâmetros da última projeção indisponíveis. Execute o pipeline manualmente com a data base e o fator desejados antes de usar este botão.' });
      const active = await github(`workflows/${WORKFLOW}/runs?branch=${BRANCH}&per_page=30`);
      if (active.workflow_runs.some(r => ATIVOS.has(r.status)))
        return res.status(409).json({ error: 'Já existe uma atualização em andamento. Aguarde a conclusão antes de iniciar outra.' });

      const requestId = randomUUID();
      await github(`workflows/${WORKFLOW}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref: BRANCH, inputs: {
          data_base: `${params[1]}/${params[2]}`, fator_ajuste: params[3],
          ignorar_queda: 'false', request_id: requestId,
        } }),
      });
      return res.status(202).json({ requestId, status: 'requested', dataBase: `${params[1]}/${params[2]}` });
    } catch (err) {
      // Não devolve erros do banco/headers de autenticação para o cliente.
      const message = err.message || '';
      const seguro = message.startsWith('O GitHub') || message.startsWith('O servidor');
      return res.status(502).json({ error: seguro ? message : 'Não foi possível consultar ou iniciar a atualização. Tente novamente; se persistir, verifique as conexões no servidor.' });
    }
  };
}

export default createHandler();
