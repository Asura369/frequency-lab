import { expect, test } from '@playwright/test';
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
});
