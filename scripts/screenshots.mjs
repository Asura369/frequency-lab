/**
 * Refreshes the reference screenshots and the Open Graph card.
 * Requires a production build in dist/.
 *   node scripts/screenshots.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 4197;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const server = spawn(
  process.execPath,
  ['scripts/preview.mjs', '--port', String(PORT)],
  { stdio: 'ignore' }
);

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${ORIGIN}/`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('preview server did not start');
}

try {
  await waitForServer();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });

  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1057 },
    deviceScaleFactor: 1,
  });
  const appPage = await desktop.newPage();
  await appPage.goto(`${ORIGIN}/app/?demo=440`);
  await appPage.waitForTimeout(24000);
  await appPage.screenshot({ path: path.resolve('public/freqlab-preview.png') });
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${ORIGIN}/app/`);
  await mobilePage.waitForTimeout(700);
  await mobilePage.screenshot({ path: path.resolve('public/freqlab-preview-mobile.png') });
  await mobile.close();

  const og = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const ogPage = await og.newPage();
  await ogPage.goto(`${ORIGIN}/`);
  await ogPage.locator('[data-demo-tone="440"]').click();
  await ogPage.waitForTimeout(2500);
  await ogPage.screenshot({ path: path.resolve('public/og.png') });
  await og.close();

  await browser.close();
  console.log('screenshots refreshed in public/');
} finally {
  server.kill('SIGKILL');
}
