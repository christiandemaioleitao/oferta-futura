// Só estes arquivos são públicos. Dados/fontes ficam fora de dist e atrás do SG.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.join(root, 'dist');
if (path.relative(root, output) !== 'dist') throw new Error('Destino de build inválido.');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output);
for (const file of ['index.html', 'css', 'js', 'assets']) {
  fs.cpSync(path.join(root, file), path.join(output, file), { recursive: true, dereference: false });
}
console.log('Site público gerado em dist; os dados são servidos pela API autenticada.');
