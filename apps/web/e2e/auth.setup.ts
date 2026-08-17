import { test as setup, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE_URL = process.env.E2E_BASE_URL || "https://aetherspec.ai";
const KEYCLOAK_URL =
  process.env.E2E_KEYCLOAK_URL || "https://auth.aetherspec.ai";
const REALM = process.env.E2E_KEYCLOAK_REALM || "aetherspec";
const CLIENT_ID = process.env.E2E_KEYCLOAK_CLIENT_ID || "aetherspec-web";

const USERS = [
  { username: "admin", password: "Aether2026!" },
  { username: "elif.demir", password: "Aether2026!" },
  { username: "ahmet.yilmaz", password: "Aether2026!" },
  { username: "selin.ozturk", password: "Aether2026!" },
];

for (const user of USERS) {
  const storageName = user.username.replace(/\./g, "-");

  setup(`authenticate ${user.username}`, async ({ page }) => {
    setup.setTimeout(90000);

    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

    // Wait for either the app login page or a Keycloak redirect to settle.
    const ssoBtn = page.getByRole("button", {
      name: /Continue with Keycloak SSO/i,
    });
    const usernameField = page.locator("#username");
    const aetherStudioBtn = page
      .getByRole("button", { name: /Aether Studio/i })
      .first();
    const loginRequiredText = page.locator("text=login_required");

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(
        aetherStudioBtn.or(ssoBtn).or(usernameField).or(loginRequiredText),
      ).toBeVisible({ timeout: 30000 });

      const url = page.url();
      const isAppAuthenticated =
        /^https:\/\/aetherspec\.ai\//.test(url) &&
        !url.includes("/login") &&
        !url.includes("error=");

      if (isAppAuthenticated) break;

      if (await usernameField.isVisible()) {
        await page.fill("#username", user.username);
        await page.fill("#password", user.password);
        await Promise.all([
          page.waitForURL(/^https:\/\/aetherspec\.ai\//, { timeout: 30000 }),
          page.click("#kc-login"),
        ]);
        break;
      }

      if (await ssoBtn.isVisible()) {
        try {
          await Promise.all([
            page.waitForURL(/keycloak|auth\.aetherspec/i, { timeout: 30000 }),
            ssoBtn.click(),
          ]);
        } catch {
          // Click/redirect may have succeeded despite a transient network error.
          await page.waitForURL(/keycloak|auth\.aetherspec|aetherspec\.ai/, {
            timeout: 15000,
          });
        }
        continue;
      }

      // login_required hash without SSO button: reload to normalize.
      await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    }

    // After auth, the SPA may briefly show a "Failed to load projects" banner while it hydrates.
    // Wait for the Aether Studio button and ensure the banner is gone before saving state.
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(aetherStudioBtn).toBeVisible({ timeout: 30000 });
      try {
        await expect(
          page.locator("text=Failed to load projects"),
        ).not.toBeVisible({ timeout: 15000 });
        break;
      } catch {
        if (attempt === 1)
          throw new Error("Projects failed to load after reload");
        await page.reload({ waitUntil: "domcontentloaded" });
      }
    }

    await page
      .context()
      .storageState({ path: `e2e/.auth/${storageName}.json` });

    const tokenResp = await page.request.post(
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
      {
        form: {
          grant_type: "password",
          client_id: CLIENT_ID,
          username: user.username,
          password: user.password,
        },
      },
    );
    expect(tokenResp.ok()).toBeTruthy();
    const tokenJson = (await tokenResp.json()) as { access_token: string };
    writeFileSync(
      `e2e/.auth/${storageName}-token.json`,
      JSON.stringify({ token: tokenJson.access_token }, null, 2),
    );
  });
}
