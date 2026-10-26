/**
 * Static link and metadata check over the built site.
 * Usage: node scripts/check-links.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const missing = new Set();
const seen = new Set();

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

function resolveTarget(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean || clean.startsWith('http') || clean.startsWith('mailto:') || clean.startsWith('data:')) {
    return null;
  }
  let target = clean.startsWith('/') ? path.join(DIST, clean) : path.resolve(path.dirname(distFile), clean);
  if (target.endsWith('/') || (existsSync(target) && statSync(target).isDirectory())) {
    target = path.join(target, 'index.html');
  } else if (!path.extname(target)) {
    target = path.join(target, 'index.html');
  }
  return target;
}

let distFile = '';
let pages = 0;

for (const file of htmlFiles(DIST)) {
  distFile = file;
  pages++;
  const html = readFileSync(file, 'utf8');
  if (!/<title>[^<]+<\/title>/.test(html)) missing.add(`${path.relative(DIST, file)}: missing <title>`);
  if (!/<meta name="description" content="[^"]+">/.test(html)) {
    missing.add(`${path.relative(DIST, file)}: missing meta description`);
  }
  const attrs = html.matchAll(/(?:href|src)="([^"]+)"/g);
  for (const match of attrs) {
    const href = match[1];
    if (href.startsWith('#')) continue;
    const target = resolveTarget(href);
    if (!target) continue;
    const key = `${href} -> ${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!existsSync(target)) missing.add(`${path.relative(DIST, file)}: ${href}`);
  }
}

console.log(`checked ${pages} pages, ${seen.size} links`);
if (missing.size) {
  console.error(`missing ${missing.size} target(s):`);
  for (const entry of missing) console.error(`  ${entry}`);
  process.exit(1);
}
console.log('all internal links and page metadata resolve');
