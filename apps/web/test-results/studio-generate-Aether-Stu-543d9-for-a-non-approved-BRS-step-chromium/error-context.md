# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: studio-generate.spec.ts >> Aether Studio generation flow >> Generate Section button exists and is enabled for a non-approved BRS step
- Location: e2e/studio-generate.spec.ts:44:3

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: /Continue with Keycloak SSO/i })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - strong [ref=e5]: AetherSpec
    - text: foundation
  - main [ref=e6]:
    - paragraph [ref=e7]: Workbench shell ready. Dockview + panels wired in later phase.
  - contentinfo [ref=e8]: "Status: foundation | Gateway: pending"
```

# Test source

```ts
  1   | import { test, expect, type Page } from '@playwright/test';
  2   | 
  3   | const BASE_URL = process.env.E2E_BASE_URL || 'https://aetherspec.ai';
  4   | const GATEWAY_URL = process.env.E2E_GATEWAY_URL || 'https://api.aetherspec.ai';
  5   | const USER = process.env.E2E_USER;
  6   | const PASS = process.env.E2E_PASS;
  7   | const PROJECT = process.env.E2E_PROJECT || 'prj-004';
  8   | 
  9   | if (!USER || !PASS) {
  10  |   throw new Error('E2E_USER and E2E_PASS environment variables are required');
  11  | }
  12  | 
  13  | async function login(page: Page) {
  14  |   await page.goto(`${BASE_URL}/`);
> 15  |   await page.getByRole('button', { name: /Continue with Keycloak SSO/i }).click();
      |                                                                           ^ Error: locator.click: Test timeout of 60000ms exceeded.
  16  |   await page.waitForURL(/keycloak|auth/i, { timeout: 10000 });
  17  |   await page.fill('#username', USER);
  18  |   await page.fill('#password', PASS);
  19  |   await page.click('#kc-login');
  20  |   await page.waitForURL(`${BASE_URL}/`, { timeout: 20000 });
  21  | }
  22  | 
  23  | async function openStudioStep(page: Page, stepName: string) {
  24  |   // Ensure Keycloak init finished and header is interactive
  25  |   await expect(page.getByRole('button', { name: /Aether Studio/i }).first()).toBeVisible({ timeout: 15000 });
  26  | 
  27  |   // Use the header's Aether Studio button (client-side navigation)
  28  |   await page.getByRole('button', { name: /Aether Studio/i }).first().click();
  29  |   await page.waitForURL(/\/studio/, { timeout: 15000 });
  30  | 
  31  |   // Switch to BRS if not already selected
  32  |   const brsTab = page.locator('button').filter({ hasText: /BRS \(/ });
  33  |   await brsTab.click();
  34  | 
  35  |   // Click the requested step in the stepper by its name
  36  |   const stepButton = page.locator('button').filter({ hasText: stepName }).first();
  37  |   await stepButton.click();
  38  | 
  39  |   // Wait for the step banner
  40  |   await expect(page.locator(`text=${stepName}`).first()).toBeVisible({ timeout: 15000 });
  41  | }
  42  | 
  43  | test.describe('Aether Studio generation flow', () => {
  44  |   test('Generate Section button exists and is enabled for a non-approved BRS step', async ({ page }) => {
  45  |     test.setTimeout(60000);
  46  |     await login(page);
  47  |     await page.goto(`${BASE_URL}/`);
  48  |     await openStudioStep(page, 'Business Context');
  49  | 
  50  |     const generateBtn = page.getByRole('button', { name: /Generate Section/i });
  51  |     await expect(generateBtn).toBeVisible();
  52  |     await expect(generateBtn).toBeEnabled();
  53  |   });
  54  | 
  55  |   test('Clicking Generate Section streams content and shows HITL card', async ({ page }) => {
  56  |     test.setTimeout(300000);
  57  |     await login(page);
  58  | 
  59  |     // Reset Step 4 to NOT_STARTED so repeated test runs don't fail after approve test
  60  |     const docResp = await page.request.get(`${GATEWAY_URL}/api/document?projectId=${PROJECT}`);
  61  |     expect(docResp.ok()).toBeTruthy();
  62  |     const docs = await docResp.json();
  63  |     const brsDoc = docs.find((d: { docType: string }) => d.docType === 'brs');
  64  |     expect(brsDoc).toBeDefined();
  65  |     const resetResp = await page.request.patch(`${GATEWAY_URL}/api/document/${brsDoc.id}/step/4`, {
  66  |       data: { content: '', status: 'NOT_STARTED' },
  67  |       headers: { 'Content-Type': 'application/merge-patch+json' },
  68  |     });
  69  |     expect(resetResp.ok()).toBeTruthy();
  70  | 
  71  |     await page.goto(`${BASE_URL}/`);
  72  |     await openStudioStep(page, 'Business Context');
  73  | 
  74  |     // Capture browser console logs for debugging SSE/CORS issues
  75  |     const consoleLogs: string[] = [];
  76  |     page.on('console', (msg) => {
  77  |       consoleLogs.push(`${msg.type()}: ${msg.text()}`);
  78  |     });
  79  |     page.on('pageerror', (err) => {
  80  |       consoleLogs.push(`pageerror: ${err.message}`);
  81  |     });
  82  | 
  83  |     const generateBtn = page.getByRole('button', { name: /Generate Section/i });
  84  |     await generateBtn.click();
  85  | 
  86  |     // Wait for generation state
  87  |     await expect(page.getByRole('button', { name: /Generating/i })).toBeVisible({ timeout: 5000 });
  88  | 
  89  |     // Wait for status messages in chat
  90  |     await expect(page.locator('text=Generating Section 4: Business Context').first()).toBeVisible({ timeout: 30000 });
  91  |     await expect(page.locator('text=Running quality checks').first()).toBeVisible({ timeout: 60000 });
  92  | 
  93  |     // Wait for HITL card or Ready card
  94  |     const card = page.locator('.mt-3.p-3.rounded-lg.bg-background').first();
  95  |     await expect(card).toBeVisible({ timeout: 120000 });
  96  | 
  97  |     // HITL card has correct status badge (HITL Review if findings, Ready if none)
  98  |     await expect(
  99  |       card.locator('text=HITL Review').or(card.locator('text=Ready')).first()
  100 |     ).toBeVisible();
  101 | 
  102 |     // HITL card has Approve and Request Revision buttons
  103 |     await expect(card.getByRole('button', { name: /Approve/i })).toBeVisible();
  104 |     await expect(card.getByRole('button', { name: /Request Revision/i })).toBeVisible();
  105 | 
  106 |     // Switch to Split view to inspect editor content
  107 |     await page.getByRole('button', { name: /Split/i }).click();
  108 | 
  109 |     // Editor should have content
  110 |     const editor = page.locator('textarea');
  111 |     await expect.poll(async () => (await editor.inputValue()).length, {
  112 |       timeout: 120000,
  113 |     }).toBeGreaterThan(100);
  114 | 
  115 |     // HITL card has Approve and Request Revision buttons
```