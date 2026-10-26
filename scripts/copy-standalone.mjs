/** Copies the single-file build into the site so /offline/ can link to it. */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const source = path.resolve('dist-offline/standalone/index.html');
const targetDir = path.resolve('dist/download');
const target = path.join(targetDir, 'frequency-lab.html');

if (!existsSync(source)) {
  console.error(`standalone build missing: ${source}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`standalone edition copied to ${path.relative(process.cwd(), target)}`);
