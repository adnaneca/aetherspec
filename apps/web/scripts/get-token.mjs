import { chromium } from 'playwright';
const BASE_URL = 'https://aetherspec.ai';
const USER = process.env.E2E_USER;
const PASS = process.env.E2E_PASS;
if (!USER || !PASS) throw new Error('E2E_USER and E2E_PASS required');
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE_URL}/login`);
await page.waitForLoadState('networkidle');
const ssoBtn = page.getByRole('button', { name: /Continue with Keycloak SSO/i });
await page.getByRole('button', { name: /Aether Studio/i }).first().or(ssoBtn).or(page.locator('#username')).waitFor({ state: 'visible', timeout: 15000 });
const url = page.url();
const isAppAuth = /^https:\/\/aetherspec\.ai\//.test(url) && !url.includes('/login');
const isKeycloak = /keycloak|auth\.aetherspec/.test(url);
if (!isAppAuth && !isKeycloak && (await ssoBtn.isVisible())) {
  await Promise.all([page.waitForURL(/keycloak|auth\.aetherspec/i, { timeout: 15000 }), ssoBtn.click()]);
}
if (!isAppAuth) {
  await page.waitForSelector('#username', { state: 'visible', timeout: 15000 });
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await Promise.all([page.waitForURL(/^https:\/\/aetherspec\.ai\//, { timeout: 30000 }), page.click('#kc-login')]);
}
await page.waitForSelector('[data-testid="user-avatar"]', { timeout: 30000 });
const token = await page.evaluate(() => window.keycloak?.token ?? null);
console.log('token length:', token?.length);
console.log('token starts:', token?.slice(0, 50));
await browser.close();
