import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASE_URL = process.env.E2E_BASE_URL || "https://aetherspec.ai";
const GATEWAY_URL = process.env.E2E_GATEWAY_URL || "https://api.aetherspec.ai";
const USER = process.env.E2E_USER;
const PASS = process.env.E2E_PASS;
const PROJECT = process.env.E2E_PROJECT || "prj-008";

if (!USER || !PASS) {
  throw new Error("E2E_USER and E2E_PASS environment variables are required");
}

const storageName = USER.replace(/\./g, "-");
const storageState = `e2e/.auth/${storageName}.json`;

test.use({ storageState });

function getAuthHeaders(): Record<string, string> {
  try {
    const raw = readFileSync(`e2e/.auth/${storageName}-token.json`, "utf-8");
    const { token } = JSON.parse(raw) as { token: string };
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

async function gotoHome(page: Page) {
  await page.goto(`${BASE_URL}/`);
  await page.waitForLoadState("networkidle");
  await expect(
    page
      .getByRole("button", { name: /Aether Studio/i })
      .first()
      .or(page.getByRole("button", { name: /Continue with Keycloak SSO/i })),
  ).toBeVisible({ timeout: 30000 });
}

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("networkidle");
  const ssoBtn = page.getByRole("button", {
    name: /Continue with Keycloak SSO/i,
  });
  await expect(
    page
      .getByRole("button", { name: /Aether Studio/i })
      .first()
      .or(ssoBtn)
      .or(page.locator("#username")),
  ).toBeVisible({ timeout: 15000 });

  const url = page.url();
  const isAppAuthenticated =
    /^https:\/\/aetherspec\.ai\//.test(url) && !url.includes("/login");
  const isKeycloak = /keycloak|auth\.aetherspec/.test(url);

  if (!isAppAuthenticated && !isKeycloak && (await ssoBtn.isVisible())) {
    await Promise.all([
      page.waitForURL(/keycloak|auth\.aetherspec/i, { timeout: 15000 }),
      ssoBtn.click(),
    ]);
  }

  if (!isAppAuthenticated) {
    await page.waitForSelector("#username", {
      state: "visible",
      timeout: 15000,
    });
    await page.fill("#username", USER);
    await page.fill("#password", PASS);
    await Promise.all([
      page.waitForURL(/^https:\/\/aetherspec\.ai\//, { timeout: 30000 }),
      page.click("#kc-login"),
    ]);
  }

  await expect(
    page.getByRole("button", { name: /Aether Studio/i }).first(),
  ).toBeVisible({ timeout: 30000 });
}

async function openStudioStep(page: Page, stepName: string) {
  await expect(
    page.getByRole("button", { name: /Aether Studio/i }).first(),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("button", { name: /Aether Studio/i })
    .first()
    .click();
  await page.waitForURL(/\/studio/, { timeout: 15000 });

  const brsTab = page.locator("button").filter({ hasText: /BRS \(/ });
  await brsTab.click();

  const stepButton = page
    .locator("button")
    .filter({ hasText: stepName })
    .first();
  await stepButton.click();

  await expect(page.locator(`text=${stepName}`).first()).toBeVisible({
    timeout: 15000,
  });
}

async function resetStep(page: Page, stepNumber: number) {
  const authHeaders = getAuthHeaders();
  const docResp = await page.request.get(
    `${GATEWAY_URL}/api/document?projectId=${PROJECT}`,
    {
      headers: authHeaders,
    },
  );
  expect(docResp.ok()).toBeTruthy();
  const docs = await docResp.json();
  const brsDoc = docs.find((d: { docType: string }) => d.docType === "brs");
  expect(brsDoc).toBeDefined();
  const resetResp = await page.request.patch(
    `${GATEWAY_URL}/api/document/${brsDoc.id}/step/${stepNumber}`,
    {
      data: { content: "", status: "NOT_STARTED" },
      headers: {
        "Content-Type": "application/merge-patch+json",
        ...authHeaders,
      },
    },
  );
  expect(resetResp.ok()).toBeTruthy();
  return brsDoc.id;
}

function captureLogs(page: Page) {
  const logs: string[] = [];
  page.on("console", (msg) => {
    try {
      logs.push(`${msg.type()}: ${msg.text()}`);
    } catch {
      // Ignore Playwright console capture edge cases.
    }
  });
  page.on("pageerror", (err) => logs.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    logs.push(
      `requestfailed: ${req.method()} ${req.url()} ${req.failure()?.errorText ?? "unknown"}`,
    );
  });
  return logs;
}

function printLogs(logs: string[]) {
  if (logs.length > 0) {
    console.log("Browser logs:\n" + logs.join("\n"));
  }
}

test.describe("Aether Studio interactive BRS workflow", () => {
  test("Generate Section starts interactive workflow and shows Question card", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await gotoHome(page);
    await resetStep(page, 1);
    await openStudioStep(page, "Introduction");

    const consoleLogs = captureLogs(page);

    await page.getByRole("button", { name: /Generate Section/i }).click();

    // Compact status banner appears
    await expect(page.locator("text=relevance").first()).toBeVisible({
      timeout: 30000,
    });

    // Question card for relevance check
    await expect(
      page.locator("text=Is this section applicable").first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByRole("button", { name: /Submit Answers/i }),
    ).toBeVisible();

    printLogs(consoleLogs);
  });

  test("Interactive workflow: relevance → suggestions → expectations → options → review", async ({
    page,
  }) => {
    test.setTimeout(600000);
    await gotoHome(page);
    await resetStep(page, 1);
    await openStudioStep(page, "Introduction");

    const consoleLogs = captureLogs(page);

    async function waitForRelevanceOutcome(timeout = 120000) {
      await expect(
        page
          .locator("text=Negotiator proposes answers")
          .first()
          .or(page.locator("text=Resume failed"))
          .or(page.locator("text=Error:")),
      ).toBeVisible({ timeout });
    }

    async function submitRelevanceAnswer() {
      // ── Relevance: answer YES ──
      const relevanceCard = page
        .locator('[data-testid="workflow-card"]')
        .last();
      const textarea = relevanceCard.locator("textarea").first();
      if ((await textarea.isVisible()) && (await textarea.isEnabled())) {
        await textarea.fill("YES");
      }
      const submitBtn = relevanceCard.getByRole("button", {
        name: /Submit Answers/i,
      });
      await expect(submitBtn).toBeVisible({ timeout: 15000 });
      await submitBtn.click();

      await waitForRelevanceOutcome();
    }

    // ── Start workflow ──
    await page.getByRole("button", { name: /Generate Section/i }).click();
    await expect(
      page.locator("text=Is this section applicable").first(),
    ).toBeVisible({ timeout: 60000 });

    await submitRelevanceAnswer();

    // Wait for the suggestion card to appear, allowing time for the agent round-trip.
    await expect(
      page.locator("text=Negotiator proposes answers").first(),
    ).toBeVisible({ timeout: 120000 });

    // ── Suggestions: accept first suggestion ──
    const suggestionCard = page.locator('[data-testid="workflow-card"]').last();
    await suggestionCard
      .getByRole("button", { name: /^Accept$/i })
      .first()
      .click();
    await suggestionCard
      .getByRole("button", { name: /Submit Answers/i })
      .click();

    // ── Expectations: fill and submit ──
    await expect(
      page.locator("text=Asking about expectations").first(),
    ).toBeVisible({ timeout: 60000 });
    const expectationsCard = page
      .locator('[data-testid="workflow-card"]')
      .last();
    const expTextareas = expectationsCard.locator("textarea");
    await expect
      .poll(async () => await expTextareas.count(), { timeout: 60000 })
      .toBeGreaterThanOrEqual(1);
    for (let i = 0; i < (await expTextareas.count()); i++) {
      await expTextareas.nth(i).fill(`Expectation ${i + 1}`);
    }
    await expectationsCard
      .getByRole("button", { name: /Submit Answers/i })
      .click();

    // ── Options: select Option A ──
    await expect(page.locator("text=Structure Options").first()).toBeVisible({
      timeout: 60000,
    });
    const optionCard = page.locator('[data-testid="workflow-card"]').last();
    await optionCard
      .locator("button")
      .filter({ hasText: /^Option A/i })
      .first()
      .click();

    // ── Generation / validation / review ──
    await expect(
      page.locator("text=Generating section content").first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.locator("text=Draft ready for review").first(),
    ).toBeVisible({ timeout: 300000 });

    // Editor should have streamed content
    await page.getByRole("button", { name: /Split/i }).click();
    await expect
      .poll(
        async () =>
          (await page.locator("textarea").first().inputValue()).length,
        {
          timeout: 120000,
        },
      )
      .toBeGreaterThan(100);

    // Review card has approve button
    const reviewCard = page.locator('[data-testid="workflow-card"]').last();
    await reviewCard
      .getByRole("button", { name: /Approve/i })
      .first()
      .click();
    await reviewCard
      .getByRole("button", { name: /Confirm: Approve \u0026 Lock Section/i })
      .click();

    // Wait for done status
    await expect(
      page.locator("text=Section approved and locked").first(),
    ).toBeVisible({ timeout: 60000 });

    printLogs(consoleLogs);
  });

  test("Workflow state restores after page reload", async ({ page }) => {
    test.setTimeout(180000);
    await gotoHome(page);
    await resetStep(page, 1);
    await openStudioStep(page, "Introduction");

    // Start workflow and pause at relevance question
    await page.getByRole("button", { name: /Generate Section/i }).click();
    await expect(
      page.locator("text=Is this section applicable").first(),
    ).toBeVisible({ timeout: 60000 });

    // Reload page
    await page.reload();
    await openStudioStep(page, "Introduction");

    // The restored question card should appear
    await expect(page.locator("text=Workflow restored").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.locator("text=Is this section applicable").first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
