import { test as setup, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'https://aetherspec.ai';

const USERS = [
  { username: 'admin', password: 'Aether2026!' },
  { username: 'elif.demir', password: 'Aether2026!' },
  { username: 'ahmet.yilmaz', password: 'Aether2026!' },
  { username: 'selin.ozturk', password: 'Aether2026!' },
];

for (const user of USERS) {
  const storageName = user.username.replace(/\./g, '-');

  setup(`authenticate ${user.username}`, async ({ page }) => {
    setup.setTimeout(60000);

    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');

    const url = page.url();
    const isAppAuthenticated = /^https:\/\/aetherspec\.ai\//.test(url) && !url.includes('/login');
    const isKeycloak = /keycloak|auth\.aetherspec/.test(url);

    if (!isAppAuthenticated && !isKeycloak) {
      // Click SSO button and wait for Keycloak login form
      const ssoBtn = page.getByRole('button', { name: /Continue with Keycloak SSO/i });
      await expect(ssoBtn).toBeVisible({ timeout: 15000 });
      await Promise.all([
        page.waitForURL(/keycloak|auth\.aetherspec/i, { timeout: 15000 }),
        ssoBtn.click(),
      ]);
    }

    if (!isAppAuthenticated) {
      await page.waitForSelector('#username', { timeout: 15000 });
      await page.fill('#username', user.username);
      await page.fill('#password', user.password);

      await Promise.all([
        page.waitForURL(/^https:\/\/aetherspec\.ai\//, { timeout: 30000 }),
        page.click('#kc-login'),
      ]);
    }

    // Wait for a signed-in indicator
    await expect(page.getByRole('button', { name: /Aether Studio/i }).first()).toBeVisible({ timeout: 30000 });

    await page.context().storageState({ path: `e2e/.auth/${storageName}.json` });
  });
}
