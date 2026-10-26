import { spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';

const PORT = 4198;
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${ORIGIN}/app/`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('preview server did not start');
}

test('the workbench reloads with the server stopped', async ({ page }) => {
  const server = spawn(
    process.execPath,
    ['scripts/preview.mjs', '--port', String(PORT)],
    { stdio: 'ignore' }
  );

  try {
    await waitForServer();
    const failed: string[] = [];
    page.on('requestfailed', (request) => failed.push(request.url()));

    await page.goto(`${ORIGIN}/app/?t=528&tol=2`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10_000 });
    await page.waitForFunction(
      async () => {
        const names = await caches.keys();
        if (!names.length) return false;
        const cache = await caches.open(names[0]);
        const keys = (await cache.keys()).map((request) => new URL(request.url).pathname);
        return keys.includes('/app/') && keys.filter((key) => key.startsWith('/assets/')).length >= 3;
      },
      null,
      { timeout: 15_000 }
    );

    server.kill('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 700));

    await page.reload();
    await expect(page.locator('#targetInput')).toBeVisible();
    expect(await page.evaluate(() => typeof window.__freqLab)).toBe('object');
    expect(failed).toEqual([]);
  } finally {
    server.kill('SIGKILL');
  }
});
