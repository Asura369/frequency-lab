import path from 'node:path';
import { expect, test } from '@playwright/test';
import { writeMixWav } from './audio';
import { startDemo } from './helpers';

// Baselines are generated on macOS with Chrome; CI runs the functional suites only.
test.skip(!!process.env.CI, 'visual baselines are platform-specific');

test.describe('visual', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('landing hero', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('landing.png', { maxDiffPixelRatio: 0.02 });
  });

  test('workbench with a running tone', async ({ page }) => {
    await startDemo(page, 440);
    await page.waitForTimeout(2500);
    await expect(page).toHaveScreenshot('workbench.png', { maxDiffPixelRatio: 0.02 });
  });

  test('guide article', async ({ page }) => {
    await page.goto('/guides/verify-432-vs-440/');
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('guide.png', { maxDiffPixelRatio: 0.02 });
  });

  test('whole-file report', async ({ page }) => {
    const wav = path.resolve('.tmp/visual-report.wav');
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
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('report.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      mask: [page.locator('#reportStats > div:last-child'), page.locator('.app-bar')],
    });
  });
});
