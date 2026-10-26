// O SQL Server continua acessível só pelo pipeline; o token do GitHub fica no servidor.
const REPO = 'christiandemaioleitao/oferta-futura';
const WORKFLOW = 'pipeline-of.yml';
const BRANCH = 'main';
const ATIVOS = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const ORIGENS = [/^https:\/\/oferta-futura[a-z0-9-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/];
const resumo = run => ({ id: run.id, status: run.status, conclusion: run.conclusion || null });

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ORIGENS.some(re => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const senha = process.env.SINTESE_UPLOAD_SENHA;
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  if (!senha || !token) return res.status(503).json({ error: 'Atualização desativada: configure SINTESE_UPLOAD_SENHA e GITHUB_ACTIONS_TOKEN na Vercel.' });
  const body = req.body || {};
  if (String(body.senha || '') !== senha) return res.status(401).json({ error: 'Senha incorreta.' });
  if (!['iniciar', 'status'].includes(body.action)) return res.status(400).json({ error: 'Ação inválida.' });
  if (body.action === 'status' && !/^[1-9]\d{0,19}$/.test(String(body.id || ''))) {
    return res.status(400).json({ error: 'Execução inválida.' });
  }

  async function github(path, data) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
      method: data ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'oferta-futura',
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    // Não devolver respostas brutas do GitHub: o repositório é privado.
    if (!r.ok) throw new Error(`GitHub indisponível (HTTP ${r.status}). Verifique o token e a permissão Actions de leitura e escrita.`);
    return r.json();
  }

  try {
    if (body.action === 'status') {
      const run = await github(`actions/runs/${body.id}`);
      if (run.path?.split('@')[0] !== `.github/workflows/${WORKFLOW}` || run.head_branch !== BRANCH) {
        return res.status(404).json({ error: 'Execução não pertence à atualização do dashboard.' });
      }
      return res.status(200).json({ run: resumo(run) });
    }
    const lista = await github(`actions/workflows/${WORKFLOW}/runs?branch=${BRANCH}&per_page=30`);
    const ativo = lista.workflow_runs.find(run => ATIVOS.has(run.status));
    if (ativo) return res.status(200).json({ run: resumo(ativo), existente: true });
    // Preserva o recorte da última projeção; a guarda de sanidade continua ligada.
    const run = await github(`actions/workflows/${WORKFLOW}/dispatches`, {
      ref: BRANCH, inputs: { manter_parametros: true },
    });
    return res.status(202).json({ run: { id: run.workflow_run_id, status: 'queued', conclusion: null } });
  } catch (err) {
    const message = err.name === 'TimeoutError' ? 'O GitHub demorou para responder. Verifique o andamento antes de iniciar outra atualização.' : err.message;
    return res.status(502).json({ error: message });
  }
}
