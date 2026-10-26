import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { writeToneWav } from './audio';
import { canvasHasInk, selfTest, startDemo, watchErrors } from './helpers';

const TMP = path.resolve('.tmp');

test.describe('workbench', () => {
  test.beforeAll(() => mkdirSync(TMP, { recursive: true }));

  test('self-test reads 440, 432 and 528 Hz', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/app/');
    const { text } = await selfTest(page);
    expect(text).toContain('Self-test passed');
    const values = [...text.matchAll(/([\d.]+) Hz target\s+→\s+([\d.]+) Hz/g)].map((match) => ({
      target: Number.parseFloat(match[1]),
      measured: Number.parseFloat(match[2]),
    }));
    expect(values.map((value) => value.target)).toEqual([440, 432, 528]);
    for (const value of values) expect(Math.abs(value.measured - value.target)).toBeLessThan(0.25);
    errors.check();
  });

  test('deep links set the target and the URL follows edits', async ({ page }) => {
    await page.goto('/app/?t=528&tol=2');
    await expect(page.locator('#targetInput')).toHaveValue('528');
    await expect(page.locator('#tolInput')).toHaveValue('2');
    await page.locator('#targetInput').fill('639');
    await page.waitForTimeout(450);
    expect(page.url()).toContain('t=639');
    expect(page.url()).toContain('tol=2');
  });

  test('presets are generated from the shared list and update the target', async ({ page }) => {
    await page.goto('/app/');
    const chips = page.locator('#presets button');
    await expect(chips).toHaveCount(11);
    await chips.filter({ hasText: '963' }).click();
    await expect(page.locator('#targetInput')).toHaveValue('963');
    await expect(chips.filter({ hasText: '963' })).toHaveClass(/active/);
  });

  test('invalid targets are rejected with a concrete limit', async ({ page }) => {
    await page.goto('/app/');
    await page.locator('#targetInput').fill('25000');
    await expect(page.locator('#targetInput')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#verdictText')).toContainText('20 Hz and 20000 Hz');
  });

  test('contrast preference survives a reload', async ({ page }) => {
    await page.goto('/app/');
    await page.locator('#paletteBtn').click();
    await expect(page.locator('body')).toHaveClass(/contrast/);
    await page.reload();
    await expect(page.locator('body')).toHaveClass(/contrast/);
    await expect(page.locator('#paletteBtn')).toHaveAttribute('aria-pressed', 'true');
  });

  test('copy setup link puts the target in the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/app/?t=432&tol=1');
    await page.locator('#copyLink').click();
    await expect(page.locator('#status')).toContainText('Setup link copied');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('t=432');
    expect(clipboard).toContain('tol=1');
  });

  test('keyboard shortcuts pause and stop', async ({ page }) => {
    await startDemo(page, 440);
    await page.locator('h2').first().click();
    await page.keyboard.press('p');
    await expect(page.locator('#pauseBtn')).toHaveText('Resume');
    await page.keyboard.press('p');
    await expect(page.locator('#pauseBtn')).toHaveText('Pause');
    await page.keyboard.press('s');
    await expect(page.locator('#status')).toContainText('Stopped');
  });

  test('microphone path measures the fake 440 Hz device', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/app/');
    await page.locator('#micBtn').click();
    await page.waitForFunction(
      () => window.__freqLab.state.displayHz != null,
      null,
      { timeout: 20_000 }
    );
    const hz = await page.evaluate(() => window.__freqLab.state.displayHz);
    expect(Math.abs((hz as number) - 440)).toBeLessThan(1);
    await expect(page.locator('#status')).toContainText('Microphone live');
    await page.locator('#stopBtn').click();
    await expect(page.locator('#freq')).toHaveText('—');
    errors.check();
  });

  test('file analysis, exports, playback end and cleanup', async ({ page }) => {
    const wav = path.join(TMP, 'tone-gated.wav');
    writeToneWav(wav, { frequency: 440, seconds: 4, toneSeconds: 2 });

    await page.goto('/app/');
    await page.setInputFiles('#fileInput', wav);
    await expect(page.locator('#playerWrap')).toBeVisible();
    await page.waitForFunction(() => window.__freqLab.state.displayHz != null, null, {
      timeout: 20_000,
    });
    const hz = await page.evaluate(() => window.__freqLab.state.displayHz);
    expect(Math.abs((hz as number) - 440)).toBeLessThan(1);

    await page.waitForTimeout(1200);
    const csv = page.waitForEvent('download');
    await page.locator('#exportCsv').click();
    const csvDownload = await csv;
    expect(csvDownload.suggestedFilename()).toMatch(/frequency-lab-.*\.csv$/);
    const csvPath = path.join(TMP, 'export.csv');
    await csvDownload.saveAs(csvPath);
    const csvText = (await import('node:fs')).readFileSync(csvPath, 'utf8');
    expect(csvText.split('\n')[0]).toContain('t_s,dominant_hz');

    const png = page.waitForEvent('download');
    await page.locator('#exportPng').click();
    const pngDownload = await png;
    expect(pngDownload.suggestedFilename()).toMatch(/frequency-lab-.*\.png$/);

    await expect(page.locator('#status')).toContainText('Playback ended', { timeout: 15_000 });
    await expect(page.locator('#freq')).toHaveText('—');
    await page.locator('#stopBtn').click().catch(() => undefined);
    await expect(page.locator('#playerWrap')).toBeHidden();
  });

  test('a corrupt file is rejected and cleaned up', async ({ page }) => {
    const bad = path.join(TMP, 'broken.mp4');
    writeFileSync(bad, Buffer.from('this is not a media file\n'.repeat(100)));
    await page.goto('/app/');
    await page.setInputFiles('#fileInput', bad);
    await expect(page.locator('#status')).toContainText('could not be decoded', {
      timeout: 15_000,
    });
    await expect(page.locator('#playerWrap')).toBeHidden();
    await expect(page.locator('#stopBtn')).toBeDisabled();
  });

  test('idle canvases redraw after a resize', async ({ page }) => {
    await page.goto('/app/');
    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForTimeout(400);
    expect(await canvasHasInk(page, '#spectrum')).toBe(true);
    expect(await canvasHasInk(page, '#spectrogram')).toBe(true);
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('no horizontal overflow on the landing page or the workbench', async ({ page }) => {
    for (const route of ['/', '/app/']) {
      await page.goto(route);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `overflow on ${route}`).toBeLessThanOrEqual(0);
    }
  });
});

test('embed mode hides the site chrome', async ({ page }) => {
  await page.goto('/app/?embed=1');
  await expect(page.locator('#targetInput')).toBeVisible();
  await expect(page.locator('.site-nav')).toBeHidden();
  await expect(page.locator('.site-footer')).toBeHidden();
});
