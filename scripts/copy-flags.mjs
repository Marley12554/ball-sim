// Copies square country flags (flag-icons, MIT) into the app's public folder.
import { readFileSync, mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/flag-icons');
const out = join(root, 'games/ball-sim/public/flags');
mkdirSync(out, { recursive: true });
const rows = JSON.parse(readFileSync(join(src, 'country.json'), 'utf8')).filter((r) => r.iso);
let n = 0;
for (const r of rows) {
  const f = join(src, 'flags/1x1', `${r.code}.svg`);
  if (existsSync(f)) { copyFileSync(f, join(out, `${r.code}.svg`)); n++; }
}
copyFileSync(join(src, 'LICENSE'), join(out, 'LICENSE.txt'));
writeFileSync(join(out, 'README.txt'), 'Flags from flag-icons (https://github.com/lipis/flag-icons), MIT license.\n');
console.log(`copied ${n} flags`);
