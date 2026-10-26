import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

test.describe('site', () => {
  test('landing page demo measures a 440 Hz tone', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page).toHaveTitle(/Frequency Lab/);
    await page.locator('[data-demo-tone="440"]').click();
    await expect(page.locator('[data-demo-hz]')).toHaveText(/^44[01]\.\d\d$/, { timeout: 15_000 });
    await expect(page.locator('[data-demo-note]')).toContainText('440');
    errors.check();
  });

  test('every navigation link and guide resolves', async ({ page, request }) => {
    await page.goto('/');
    for (const href of ['/app/', '/guides/', '/presets/', '/how-it-works/', '/offline/', '/privacy/']) {
      const response = await request.get(href);
      expect(response.status(), href).toBe(200);
    }
    await page.goto('/guides/');
    await expect(page.locator('.guide-card')).toHaveCount(6);
    await page.locator('.guide-card').first().click();
    await expect(page.locator('.prose h1')).toBeVisible();
  });

  test('presets page is generated and links into the workbench', async ({ page }) => {
    await page.goto('/presets/');
    const rows = page.locator('.claims tbody tr');
    expect(await rows.count()).toBeGreaterThan(10);
    const link = page.locator('a.chip', { hasText: 'Open at 528 Hz' });
    await expect(link).toHaveAttribute('href', '/app/?t=528&tol=3');
    await expect(page.locator('.claims')).toContainText('not measurable here');
  });

  test('pages expose canonical, social metadata and a valid sitemap', async ({ page, request }) => {
    await page.goto('/app/');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/app\/$/
    );
    const og = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(og).toContain('Frequency Lab');
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain('<loc>');
  });

  test('the workbench is installable and pre-cached for offline use', async ({ page, request }) => {
    const manifest = await request.get('/manifest.webmanifest');
    expect(manifest.status()).toBe(200);
    const json = await manifest.json();
    expect(json.name).toBe('Frequency Lab');
    expect(json.start_url).toBe('/app/');
    expect((await request.get('/icons/icon-192.png')).status()).toBe(200);

    await page.goto('/app/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    const shell = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names[0]);
      return (await cache.keys()).map((request) => new URL(request.url).pathname);
    });
    expect(shell).toContain('/app/');
    expect(shell.some((entry) => entry.startsWith('/assets/'))).toBe(true);
  });

  test('no serious accessibility violations on key pages', async ({ page }) => {
    for (const route of ['/', '/app/', '/guides/why-loudest-peak-isnt-pitch/']) {
      await page.goto(route);
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical'
      );
      expect(
        serious.map((violation) => `${route}: ${violation.id} (${violation.nodes.length})`)
      ).toEqual([]);
    }
  });

  test('unknown routes keep the branded 404', async ({ page }) => {
    const response = await page.goto('/does-not-exist/');
    expect(response?.status()).toBe(404);
    await expect(page.locator('h1')).toContainText(/not here/i);
  });
});
