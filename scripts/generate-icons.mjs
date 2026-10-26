/**
 * Renders the PWA icons from the site favicon. Run after changing the mark:
 *   node scripts/generate-icons.mjs
 */
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/favicon.svg', 'utf8');
const outDir = path.resolve('public/icons');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });

async function render({ size, scale, background, file }) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  const inner = Math.round(size * scale);
  await page.setContent(
    `<style>
      html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${background}; }
      .wrap { width: ${size}px; height: ${size}px; display: grid; place-items: center; }
      .wrap svg { width: ${inner}px; height: ${inner}px; display: block; }
    </style>
    <div class="wrap">${svg}</div>`
  );
  await page.screenshot({ path: path.join(outDir, file), omitBackground: !background });
  await page.close();
}

await render({ size: 192, scale: 1, background: 'transparent', file: 'icon-192.png' });
await render({ size: 512, scale: 1, background: 'transparent', file: 'icon-512.png' });
await render({ size: 512, scale: 0.62, background: '#080a0e', file: 'icon-maskable-512.png' });

await browser.close();
console.log('icons written to public/icons');
