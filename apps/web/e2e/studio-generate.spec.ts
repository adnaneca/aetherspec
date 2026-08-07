import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'https://aetherspec.ai';
const GATEWAY_URL = process.env.E2E_GATEWAY_URL || 'https://api.aetherspec.ai';
const USER = process.env.E2E_USER;
const PASS = process.env.E2E_PASS;
const PROJECT = process.env.E2E_PROJECT || 'prj-004';

if (!USER || !PASS) {
  throw new Error('E2E_USER and E2E_PASS environment variables are required');
}

async function login(page: Page) {
  await page.goto(`${BASE_URL}/`);
  await page.getByRole('button', { name: /Continue with Keycloak SSO/i }).click();
  await page.waitForURL(/keycloak|auth/i, { timeout: 10000 });
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.click('#kc-login');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 20000 });
}

async function openStudioStep(page: Page, stepName: string) {
  // Ensure Keycloak init finished and header is interactive
  await expect(page.getByRole('button', { name: /Aether Studio/i }).first()).toBeVisible({ timeout: 15000 });

  // Use the header's Aether Studio button (client-side navigation)
  await page.getByRole('button', { name: /Aether Studio/i }).first().click();
  await page.waitForURL(/\/studio/, { timeout: 15000 });

  // Switch to BRS if not already selected
  const brsTab = page.locator('button').filter({ hasText: /BRS \(/ });
  await brsTab.click();

  // Click the requested step in the stepper by its name
  const stepButton = page.locator('button').filter({ hasText: stepName }).first();
  await stepButton.click();

  // Wait for the step banner
  await expect(page.locator(`text=${stepName}`).first()).toBeVisible({ timeout: 15000 });
}

test.describe('Aether Studio generation flow', () => {
  test('Generate Section button exists and is enabled for a non-approved BRS step', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);
    await page.goto(`${BASE_URL}/`);
    await openStudioStep(page, 'Business Context');

    const generateBtn = page.getByRole('button', { name: /Generate Section/i });
    await expect(generateBtn).toBeVisible();
    await expect(generateBtn).toBeEnabled();
  });

  test('Clicking Generate Section streams content and shows HITL card', async ({ page }) => {
    test.setTimeout(300000);
    await login(page);
    await page.goto(`${BASE_URL}/`);
    await openStudioStep(page, 'Business Context');

    // Capture browser console logs for debugging SSE/CORS issues
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      consoleLogs.push(`pageerror: ${err.message}`);
    });

    const generateBtn = page.getByRole('button', { name: /Generate Section/i });
    await generateBtn.click();

    // Wait for generation state
    await expect(page.getByRole('button', { name: /Generating/i })).toBeVisible({ timeout: 5000 });

    // Wait for status messages in chat
    await expect(page.locator('text=Generating Section 4: Business Context').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('text=Running quality checks').first()).toBeVisible({ timeout: 60000 });

    // Wait for HITL card or Ready card
    const card = page.locator('.mt-3.p-3.rounded-lg.bg-background').first();
    await expect(card).toBeVisible({ timeout: 120000 });

    // HITL card has correct status badge (HITL Review if findings, Ready if none)
    await expect(
      card.locator('text=HITL Review').or(card.locator('text=Ready')).first()
    ).toBeVisible();

    // HITL card has Approve and Request Revision buttons
    await expect(card.getByRole('button', { name: /Approve/i })).toBeVisible();
    await expect(card.getByRole('button', { name: /Request Revision/i })).toBeVisible();

    // Switch to Split view to inspect editor content
    await page.getByRole('button', { name: /Split/i }).click();

    // Editor should have content
    const editor = page.locator('textarea');
    await expect.poll(async () => (await editor.inputValue()).length, {
      timeout: 120000,
    }).toBeGreaterThan(100);

    // HITL card has Approve and Request Revision buttons
    await expect(card.getByRole('button', { name: /Approve/i })).toBeVisible();
    await expect(card.getByRole('button', { name: /Request Revision/i })).toBeVisible();

    if (consoleLogs.length > 0) {
      console.log('Browser logs:\n' + consoleLogs.join('\n'));
    }
  });

  test('Generate and approve advances to next step', async ({ page }) => {
    test.setTimeout(300000);
    await login(page);
    await page.goto(`${BASE_URL}/`);
    await openStudioStep(page, 'Business Context');

    const generateBtn = page.getByRole('button', { name: /Generate Section/i });
    await generateBtn.click();

    await expect(page.getByRole('button', { name: /Generating/i })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Generating Section 4: Business Context').first()).toBeVisible({ timeout: 30000 });

    const card = page.locator('.mt-3.p-3.rounded-lg.bg-background').first();
    await expect(card).toBeVisible({ timeout: 120000 });

    // Approve the generated section
    await card.getByRole('button', { name: /Approve/i }).click();

    // Wait for step advance — active step should become Step 5
    await expect(page.locator('text=Step 5:').first()).toBeVisible({ timeout: 30000 });
  });
});
