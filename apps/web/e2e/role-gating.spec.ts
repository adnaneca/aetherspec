import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'https://aetherspec.ai';

async function gotoHome(page: Page) {
  await page.goto(`${BASE_URL}/`);
  await page.waitForLoadState('networkidle');

  // Wait for Keycloak init to settle: either we are on the login page
  // or the authenticated header is rendered.
  await expect(
    page.getByRole('button', { name: /Aether Studio/i }).first()
      .or(page.getByRole('button', { name: /Continue with Keycloak SSO/i }))
  ).toBeVisible({ timeout: 30000 });
}

async function openStudioStep(page: Page, docType: string) {
  await expect(page.getByRole('button', { name: /Aether Studio/i }).first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: /Aether Studio/i }).first().click();
  await page.waitForURL(/\/studio/, { timeout: 15000 });

  // Map docType to the tab label rendered by AetherStudio.
  const tabLabel = docType === 'brs' ? 'BRS' : docType === 'srs' ? 'SRS/SDD' : 'Test Cases';
  const docTab = page.locator('button').filter({ hasText: `${tabLabel} (` }).first();
  await expect(docTab).toBeVisible({ timeout: 10000 });
  await docTab.click();

  // Wait for the stepper and click the first non-approved step
  const firstNotSignedOff = page.locator('button').filter({ hasText: /NOT STARTED|IN_PROGRESS|HAS_FINDINGS/i }).first();
  await expect(firstNotSignedOff).toBeVisible({ timeout: 10000 });
  await firstNotSignedOff.click();

  // Wait for the step banner to update
  const stepName = await firstNotSignedOff.textContent();
  await expect(page.locator('text=Step').first()).toBeVisible({ timeout: 10000 });
  if (stepName) {
    const cleanName = stepName.replace(/\s+(NOT STARTED|SIGNED OFF|IN PROGRESS|HAS FINDINGS)$/i, '');
    await expect(page.locator(`text=${cleanName}`).first()).toBeVisible({ timeout: 10000 });
  }
}

test.use({ storageState: ({}, use) => use(undefined) });

test.describe('T-01 Admin user — full access', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('Admin Settings button visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Admin Settings/i })).toBeVisible();
  });

  test('Admin Settings page loads config', async ({ page }) => {
    await page.getByRole('link', { name: /Admin Settings/i }).click();
    await page.waitForURL(/\/admin-settings/, { timeout: 10000 });
    await expect(page.locator('text=Platform Governance').first()).toBeVisible({ timeout: 10000 });
  });

  test('User badge shows real name + Admin role', async ({ page }) => {
    await expect(page.locator('text=System Admin').first()).toBeVisible();
    await expect(page.locator('text=Admin').first()).toBeVisible();
  });

  test('Can approve BRS, SRS and Test Case sections', async ({ page }) => {
    for (const docType of ['brs', 'srs', 'testcase']) {
      await gotoHome(page);
      await openStudioStep(page, docType);
      await expect(page.getByRole('button', { name: /Approve & Advance/i })).toBeVisible();
    }
  });

  // NOTE: Complete BRS visibility also requires all core BRS steps to be
  // SIGNED_OFF. That state is covered by API-level T-06; here we only assert
  // the role guard is wired (admin can see merge button when state allows).
});

test.describe('T-02 BA Lead — BRS only, no admin', () => {
  test.use({ storageState: 'e2e/.auth/elif-demir.json' });

  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('Admin Settings button hidden (DEF-001)', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Admin Settings/i })).not.toBeVisible();
  });

  test('User badge shows Elif Demir + BA Lead', async ({ page }) => {
    await expect(page.locator('text=Elif Demir').first()).toBeVisible();
    await expect(page.locator('text=BA Lead').first()).toBeVisible();
  });

  test('Can approve BRS sections', async ({ page }) => {
    await gotoHome(page);
    await openStudioStep(page, 'brs');
    await expect(page.getByRole('button', { name: /Approve & Advance/i })).toBeVisible();
  });

  test('Cannot approve SRS or Test Case sections', async ({ page }) => {
    for (const docType of ['srs', 'testcase']) {
      await gotoHome(page);
      await openStudioStep(page, docType);
      await expect(page.getByRole('button', { name: /Approve & Advance/i })).not.toBeVisible();
    }
  });

  // Merge role guard is verified at API level (T-06). The UI button is also
  // hidden when not all BRS steps are approved, so a simple visibility test is
  // not deterministic here.
});

test.describe('T-03 Solution Architect — SRS only', () => {
  test.use({ storageState: 'e2e/.auth/ahmet-yilmaz.json' });

  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('Admin Settings hidden', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Admin Settings/i })).not.toBeVisible();
  });

  test('User badge shows Ahmet Yilmaz + Architect', async ({ page }) => {
    await expect(page.locator('text=Ahmet Yilmaz').first()).toBeVisible();
    await expect(page.locator('text=Architect').first()).toBeVisible();
  });

  test('Cannot approve BRS sections', async ({ page }) => {
    await gotoHome(page);
    await openStudioStep(page, 'brs');
    await expect(page.getByRole('button', { name: /Approve & Advance/i })).not.toBeVisible();
  });

  test('Can approve SRS sections', async ({ page }) => {
    await gotoHome(page);
    await openStudioStep(page, 'srs');
    await expect(page.getByRole('button', { name: /Approve & Advance/i })).toBeVisible();
  });

  test('Cannot approve Test Case sections', async ({ page }) => {
    await gotoHome(page);
    await openStudioStep(page, 'testcase');
    await expect(page.getByRole('button', { name: /Approve & Advance/i })).not.toBeVisible();
  });

  // Merge role guard is verified at API level (T-06). The UI button is also
  // hidden when not all BRS steps are approved, so a simple visibility test is
  // not deterministic here.
});

test.describe('T-04 QA Lead — Test Cases only', () => {
  test.use({ storageState: 'e2e/.auth/selin-ozturk.json' });

  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
  });

  test('Admin Settings hidden', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Admin Settings/i })).not.toBeVisible();
  });

  test('User badge shows Selin Ozturk + QA Lead', async ({ page }) => {
    await expect(page.locator('text=Selin Ozturk').first()).toBeVisible();
    await expect(page.locator('text=QA Lead').first()).toBeVisible();
  });

  test('Cannot approve BRS or SRS sections', async ({ page }) => {
    for (const docType of ['brs', 'srs']) {
      await gotoHome(page);
      await openStudioStep(page, docType);
      await expect(page.getByRole('button', { name: /Approve & Advance/i })).not.toBeVisible();
    }
  });

  test('Can approve Test Case sections', async ({ page }) => {
    await gotoHome(page);
    await openStudioStep(page, 'testcase');
    await expect(page.getByRole('button', { name: /Approve & Advance/i })).toBeVisible();
  });

  test('Cannot complete BRS', async ({ page }) => {
    await gotoHome(page);
    await openStudioStep(page, 'brs');
    await expect(page.getByRole('button', { name: /Complete BRS/i })).not.toBeVisible();
  });
});

test.describe('T-07 Token refresh', () => {
  test.use({ storageState: 'e2e/.auth/elif-demir.json' });

  test('Authenticated API calls work without 401 within token lifetime', async ({ page }) => {
    test.setTimeout(120000);
    await gotoHome(page);

    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(`${msg.type()}: ${msg.text()}`);
    });

    await page.getByRole('button', { name: /Aether Studio/i }).first().click();
    await page.waitForURL(/\/studio/, { timeout: 15000 });
    await expect(page.locator('text=Step').first()).toBeVisible({ timeout: 15000 });

    const has401 = consoleLogs.some((l) => l.includes('401'));
    expect(has401).toBe(false);
  });

  // NOTE: A full ">5 minutes idle" refresh test requires the Keycloak SSO session
  // lifetime to be longer than the access-token lifetime. With the current Keycloak
  // config both are 5 minutes, so silent `check-sso` re-authentication fails after
  // the access token expires and the app correctly redirects to /login. This is
  // the intended fallback behaviour; extending SSO sessions is a Keycloak setting,
  // not a code change.
});
