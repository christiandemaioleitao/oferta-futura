// Sobe a planilha da SÍNTESE CONSOLIDADA para o Neon, direto do dashboard.
// Substitui a tabela inteira via staging + troca atômica, então uma falha no meio
// não derruba a tabela viva. Espelha scripts/upload_sintese.py (mesmas colunas/tipos).
//
// Segurança: endpoint público de ESCRITA. Só funciona se SINTESE_UPLOAD_SENHA existir
// no ambiente (Vercel). A senha viaja no corpo (HTTPS) e é conferida no servidor —
// nunca fica no JS do cliente. Sem a variável, o endpoint fica desligado.
//
// Fluxo (3 ações, cada uma uma requisição):
//   POST {senha, action:'init'}                  -> recria a tabela de staging
//   POST {senha, action:'chunk', rows:[[...],…]} -> insere um lote (linhas em ordem de COLS)
//   POST {senha, action:'commit', arquivo, total}-> troca staging -> viva + grava meta
import { neon } from '@neondatabase/serverless';

// nome + tipo SQL, na MESMA ordem de COLUNAS em scripts/upload_sintese.py
const COLS = [
  ['cidade', 'text'], ['bairro', 'text'], ['incorporadora', 'text'],
  ['tipoempreendimento', 'text'], ['empreendimento', 'text'],
  ['datainobr', 'date'], ['datahabt', 'date'], ['regional', 'text'], ['consorcio', 'text'],
  ['totalunidades', 'double precision'], ['privativa', 'double precision'],
  ['unidadesvendidasmes', 'double precision'], ['unidadesdistratadasmes', 'double precision'],
  ['unidadesdisponiveis', 'double precision'], ['percevolucaoobra', 'double precision'],
  ['tipologia', 'double precision'], ['precounidade', 'double precision'],
  ['datalancamento', 'date'], ['data', 'date'],
  ['macroregiao', 'double precision'], ['latitude', 'double precision'],
  ['longitude', 'double precision'], ['lancou', 'text'],
];
const NCOL = COLS.length;
const STAGE = 'sintese_stage';
const LIVE = 'sintese_consolidada';
const MAX_ROWS_CHUNK = 5000; // teto defensivo; o cliente manda ~1000

const ORIGENS = [/^https:\/\/oferta-futura[a-z0-9-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/];

function ddlStage() {
  const cols = COLS.map(([n, t]) => `"${n}" ${t}`).join(', ');
  return `CREATE TABLE "${STAGE}" (${cols})`;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ORIGENS.some(re => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const SENHA = process.env.SINTESE_UPLOAD_SENHA;
  if (!SENHA) return res.status(503).json({ error: 'Upload desativado: defina SINTESE_UPLOAD_SENHA nas variáveis de ambiente da Vercel.' });

  const body = req.body || {};
  if (String(body.senha || '') !== String(SENHA)) return res.status(401).json({ error: 'Senha incorreta.' });

  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!url) return res.status(500).json({ error: 'DATABASE_URL não configurada no servidor.' });
  const sql = neon(url);
  const action = String(body.action || '');

  try {
    if (action === 'init') {
      await sql(`DROP TABLE IF EXISTS "${STAGE}"`);
      await sql(ddlStage());
      return res.status(200).json({ ok: true });
    }

    if (action === 'chunk') {
      const rows = Array.isArray(body.rows) ? body.rows : null;
      if (!rows || !rows.length) return res.status(400).json({ error: 'Lote vazio.' });
      if (rows.length > MAX_ROWS_CHUNK) return res.status(400).json({ error: `Lote grande demais (máx ${MAX_ROWS_CHUNK}).` });
      if (rows.some(r => !Array.isArray(r) || r.length !== NCOL))
        return res.status(400).json({ error: `Cada linha precisa de ${NCOL} colunas.` });

      const colList = COLS.map(([n]) => `"${n}"`).join(', ');
      const params = [];
      const tuples = rows.map((r, i) => {
        const ph = COLS.map((_, j) => `$${i * NCOL + j + 1}`);
        r.forEach(v => params.push(v === undefined || v === '' ? null : v));
        return `(${ph.join(', ')})`;
      });
      await sql(`INSERT INTO "${STAGE}" (${colList}) VALUES ${tuples.join(', ')}`, params);
      return res.status(200).json({ ok: true, inseridas: rows.length });
    }

    if (action === 'commit') {
      // troca atômica num único statement: o bloco DO roda em uma transação, então se
      // o RENAME falhar o DROP é revertido e a tabela viva continua de pé. LIVE/STAGE são
      // constantes internas (não entrada do usuário), então não há injeção aqui.
      await sql(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '${STAGE}') THEN
          RAISE EXCEPTION 'staging inexistente — rode init/chunk antes do commit';
        END IF;
        DROP TABLE IF EXISTS "${LIVE}";
        ALTER TABLE "${STAGE}" RENAME TO "${LIVE}";
      END $$;`);
      const total = Number(body.total) || null;
      const arquivo = String(body.arquivo || '').slice(0, 200);
      await sql(
        `CREATE TABLE IF NOT EXISTS of_meta (chave text PRIMARY KEY, valor text, atualizado_em timestamptz DEFAULT now())`);
      await sql(
        `INSERT INTO of_meta (chave, valor, atualizado_em) VALUES ('sintese_linhas', $1, now()), ('sintese_arquivo', $2, now())
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
        [String(total), arquivo]);
      const [{ n }] = await sql(`SELECT count(*)::int AS n FROM "${LIVE}"`);
      return res.status(200).json({ ok: true, linhas: n });
    }

    return res.status(400).json({ error: 'Ação inválida.' });
  } catch (err) {
    return res.status(400).json({ error: 'Erro no upload: ' + (err.message || String(err)) });
  }
}
