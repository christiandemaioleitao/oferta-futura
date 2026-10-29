import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { requireApiSession } from '../lib/security-node.mjs';

export default async function handler(req, res) {
  if (!(await requireApiSession(req, res))) return;
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ error: 'Use GET.' });
  const file = req.query?.file;
  const schema = file === 'sintese_schema.json';
  if (typeof file !== 'string' || (!schema && !/^(?:(?:dados_of|mapa_of|bairros_of|plano_diretor|portal_coordenadas)\.js|atualizacao\.json|plano_diretor\/[a-z0-9-]+\.json)$/.test(file))) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
  try {
    const root = await realpath(schema ? process.cwd() : path.join(process.cwd(), 'data'));
    const target = await realpath(path.join(root, file));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    const content = await readFile(target);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', content.length);
    return res.status(200).end(req.method === 'HEAD' ? undefined : content);
  } catch {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
}
