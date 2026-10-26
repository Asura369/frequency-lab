import type { Page } from '@playwright/test';

export interface PageErrors {
  errors: string[];
  check: () => void;
}

/** Collects page errors and console errors; call check() at the end of a test. */
export function watchErrors(page: Page): PageErrors {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return {
    errors,
    check() {
      if (errors.length) throw new Error(`page reported errors:\n${errors.join('\n')}`);
    },
  };
}

export async function startDemo(page: Page, hz = 440): Promise<void> {
  await page.goto(`/app/?demo=${hz}`);
  await page.waitForFunction(() => window.__freqLab && window.__freqLab.state.running, null, {
    timeout: 15_000,
  });
  await page.waitForFunction(() => window.__freqLab.state.displayHz != null, null, {
    timeout: 15_000,
  });
}

export async function stopSession(page: Page): Promise<void> {
  const stop = page.locator('#stopBtn');
  if (await stop.isEnabled()) await stop.click();
}

export async function selfTest(page: Page): Promise<{ text: string; values: number[] }> {
  await page.evaluate(() => window.__freqLab.runSelfTest(true));
  await page.waitForFunction(
    () => /Self-test (passed|failed)/.test(document.getElementById('selfTestOut')?.textContent || ''),
    null,
    { timeout: 20_000 }
  );
  const text = (await page.locator('#selfTestOut').textContent()) || '';
  const values = [...text.matchAll(/([\d.]+) Hz/g)].map((match) => Number.parseFloat(match[1]));
  return { text, values };
}

export async function canvasHasInk(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let bright = 0;
    for (let i = 0; i < data.length; i += 16) {
      if (data[i] + data[i + 1] + data[i + 2] > 180) bright++;
    }
    return bright > 20;
  }, selector);
}
