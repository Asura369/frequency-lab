import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { writeMixWav, writeToneWav } from './audio';
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
    await page.locator('#status').click();
    await page.keyboard.press('p');
    await expect(page.locator('#pauseBtn')).toHaveText('Resume');
    await page.keyboard.press('p');
    await expect(page.locator('#pauseBtn')).toHaveText('Pause');
    await page.keyboard.press('s');
    await expect(page.locator('#status')).toContainText('Stopped');
  });

  test('the diagnostics test tone is audible', async ({ page }) => {
    await page.goto('/app/');
    await page.evaluate(() => (document.getElementById('toneBtn') as HTMLButtonElement).click());
    await page.waitForFunction(() => window.__freqLab.state.running, null, { timeout: 15_000 });
    const gain = await page.evaluate(() => window.__freqLab.state.outGain?.gain.value ?? 0);
    expect(gain).toBeGreaterThan(0.05);
    await expect(page.locator('#status')).toContainText('playing quietly');
    await page.locator('#stopBtn').click();
  });

  test('the target card separates presence from dominance', async ({ page }) => {
    const wav = path.join(TMP, 'mix-963-639-396.wav');
    writeMixWav(
      wav,
      [
        { hz: 963.5, amp: 0.34 },
        { hz: 639.9, amp: 0.17 },
        { hz: 396.3, amp: 0.05 },
      ],
      5
    );
    await page.goto('/app/?t=396&tol=3');
    await page.setInputFiles('#fileInput', wav);
    await page.waitForFunction(() => window.__freqLab.state.displayHz != null, null, {
      timeout: 20_000,
    });
    await page.waitForFunction(
      () => {
        const meta = document.getElementById('targetMeta')?.textContent || '';
        return meta.includes('396') && meta.includes('below the strongest peak');
      },
      null,
      { timeout: 20_000 }
    );
    const meta = (await page.locator('#targetMeta').textContent()) || '';
    expect(meta).toContain('396');
    expect(meta).toMatch(/9[0-9]{2}\.[0-9]/);
    await expect(page.locator('#verdictText')).toContainText('tone-like peak');
    const dominant = Number.parseFloat((await page.locator('#freq').textContent()) || '0');
    expect(dominant).toBeGreaterThan(900);
    await page.locator('#stopBtn').click();
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

  test('whole-file analysis renders a report, exports and returns to live', async ({ page }) => {
    const wav = path.join(TMP, 'whole-file-mix.wav');
    writeMixWav(
      wav,
      [
        { hz: 963.5, amp: 0.34 },
        { hz: 639.9, amp: 0.17 },
        { hz: 396.3, amp: 0.05 },
      ],
      6
    );

    await page.goto('/app/?t=396&tol=3');
    await page.setInputFiles('#analyseInput', wav);
    await expect(page.locator('#reportBody')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#reportPercent')).toHaveText('100');
    await expect(page.locator('#reportVerdict')).toHaveText('tone present');
    await expect(page.locator('#reportTargetText')).toContainText('396.0 Hz');
    await expect(page.locator('#reportSections tr')).toHaveCount(10);
    await expect(page.locator('#reportPeaks tr')).toHaveCount(3);
    expect(await canvasHasInk(page, '#reportSpectrogram')).toBe(true);

    const jsonEvent = page.waitForEvent('download');
    await page.locator('#exportReportJson').click();
    const jsonDownload = await jsonEvent;
    expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);
    const jsonPath = path.join(TMP, 'report.json');
    await jsonDownload.saveAs(jsonPath);
    const payload = JSON.parse((await import('node:fs')).readFileSync(jsonPath, 'utf8'));
    expect(payload.schema).toBe('freqlab/report@1');
    expect(payload.target.valid).toBe(true);
    expect(payload.target.percent).toBeGreaterThan(80);
    expect(payload.sections).toHaveLength(10);
    expect(payload.spectrogram).toBeUndefined();

    const csvEvent = page.waitForEvent('download');
    await page.locator('#exportReportCsv').click();
    const csvDownload = await csvEvent;
    expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/);

    await page.locator('#reportClose').click();
    await expect(page.locator('#reportView')).toBeHidden();
    await expect(page.locator('.workspace')).toBeVisible();
    await expect(page.locator('#micBtn')).toBeEnabled();
    await expect(page.locator('#analyseInput')).toBeEnabled();
  });

  test('whole-file analysis reports silence without inventing a percentage', async ({ page }) => {
    const wav = path.join(TMP, 'whole-file-silence.wav');
    writeToneWav(wav, { frequency: 440, seconds: 2, toneSeconds: 0 });
    await page.goto('/app/?t=440&tol=3');
    await page.setInputFiles('#analyseInput', wav);
    await expect(page.locator('#reportBody')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#reportPercent')).toHaveText('—');
    await expect(page.locator('#reportVerdict')).toHaveText('no signal');
    await expect(page.locator('#reportTargetText')).toContainText('No signal');
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
