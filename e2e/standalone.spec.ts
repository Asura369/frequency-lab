import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { selfTest } from './helpers';

test('the single-file build works from file://', async ({ page }) => {
  const url = pathToFileURL(path.resolve('dist/download/frequency-lab.html')).href;
  await page.goto(url);

  await expect(page.locator('#protocolNotice')).toBeVisible();
  await expect(page.locator('#micBtn')).toBeVisible();

  const { text } = await selfTest(page);
  expect(text).toContain('Self-test passed');

  const wav = path.resolve('.tmp/standalone-tone.wav');
  const { writeToneWav } = await import('./audio');
  writeToneWav(wav, { frequency: 432, seconds: 3, toneSeconds: 3 });
  await page.setInputFiles('#fileInput', wav);
  await page.waitForFunction(() => window.__freqLab.state.displayHz != null, null, {
    timeout: 20_000,
  });
  const hz = await page.evaluate(() => window.__freqLab.state.displayHz);
  expect(Math.abs((hz as number) - 432)).toBeLessThan(1);
});
