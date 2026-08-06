import { expect, test } from "@playwright/test";

import { createActiveUser, query } from "./helpers/db";
import {
  startProductionEquivalentProxy,
  type ProductionProxy,
} from "./helpers/production-proxy-harness";

/**
 * Login / logout / login-again through a local reverse proxy that reproduces
 * the committed production nginx header contract (see
 * `tests/e2e/helpers/production-proxy-harness.ts`).
 *
 * What this proves: the intended production relationship — browser Host equals
 * the forwarded Host and `X-Forwarded-Host`, `Origin` agrees with both, and the
 * dedicated client-IP header is server-derived — allows a full auth cycle.
 *
 * What this does not prove: behaviour against the live production deployment.
 * The local listener is HTTP, so `$scheme` is `http` here; no production access
 * is performed by this suite.
 */

const PASSWORD = "Stage313C-proxy-login!";

function assertProductionHeaderContract(proxy: ProductionProxy) {
  expect(proxy.forwarded.length).toBeGreaterThan(0);
  for (const record of proxy.forwarded) {
    // `proxy_set_header Host $host` and `X-Forwarded-Host $host`.
    expect(record.forwardedHost).toBe(record.browserHost);
    expect(record.forwardedProto).toBe("http");
    // Overwritten from `$remote_addr`, never from a browser header.
    expect(record.clientIp).toBe("127.0.0.1");
    if (record.browserOrigin) {
      expect(record.browserOrigin).toBe(
        `${record.forwardedProto}://${record.forwardedHost}`,
      );
    }
  }
}

async function loginThroughProxy(
  page: import("@playwright/test").Page,
  email: string,
) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /Log in|Войти/ }).click();
}

test("login, logout, and login again succeed through the production-equivalent proxy @browser-smoke", async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error("Playwright baseURL is required.");

  const proxy = await startProductionEquivalentProxy({
    upstreamOrigin: baseURL,
  });
  const user = await createActiveUser({
    email: undefined,
    password: PASSWORD,
    preferredLocale: "en",
  });
  const context = await browser.newContext({ baseURL: proxy.origin });
  const page = await context.newPage();

  try {
    await page.goto("/login?returnUrl=%2Fdashboard");
    await expect(
      page.getByRole("heading", { name: /Welcome back|С возвращением/ }),
    ).toBeVisible();

    await loginThroughProxy(page, user.email);
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
    await expect(page.getByTestId("account-menu-trigger")).toBeVisible();
    expect(
      (await context.cookies()).some((cookie) => cookie.name === "auth_session"),
    ).toBe(true);

    await page.getByTestId("account-menu-trigger").click();
    await page.getByTestId("account-menu-logout").press("Enter");
    await expect(page).toHaveURL(/\/login$/);
    expect(
      (await context.cookies()).some((cookie) => cookie.name === "auth_session"),
    ).toBe(false);

    await loginThroughProxy(page, user.email);
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
    await expect(page.getByTestId("account-menu-trigger")).toBeVisible();
    await expect(page.getByText("This page couldn’t load")).toHaveCount(0);

    assertProductionHeaderContract(proxy);
  } finally {
    // Bounded, PII-free proxy trace so a later production comparison has
    // something concrete to check against. No cookies, tokens or bodies.
    await testInfo.attach("proxy-forwarded-requests.json", {
      body: JSON.stringify(proxy.forwarded, null, 2),
      contentType: "application/json",
    });
    await context.close();
    await proxy.close();
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});

test("a mismatched forwarded host does not silently become a trusted origin @browser-smoke", async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error("Playwright baseURL is required.");

  // Deliberately violates the nginx contract: the forwarded host no longer
  // equals the browser host, which is the synthetic condition the independent
  // review flagged as unproven for production.
  const proxy = await startProductionEquivalentProxy({
    upstreamOrigin: baseURL,
    forwardedHostOverride: "attacker.example",
    forwardedProtoOverride: "https",
  });
  const user = await createActiveUser({
    email: undefined,
    password: PASSWORD,
    preferredLocale: "en",
  });
  const context = await browser.newContext({ baseURL: proxy.origin });
  const page = await context.newPage();

  try {
    await page.goto("/login");
    await loginThroughProxy(page, user.email);

    // Either the Server Action is refused or the session is simply not
    // established. Both are acceptable; silently trusting the forged host and
    // landing on the dashboard is not.
    await page.waitForTimeout(1500);
    const sessionEstablished = (await context.cookies()).some(
      (cookie) => cookie.name === "auth_session",
    );
    expect(sessionEstablished).toBe(false);
    await expect(page).not.toHaveURL(/\/dashboard/);

    for (const record of proxy.forwarded) {
      expect(record.forwardedHost).toBe("attacker.example");
      expect(record.forwardedHost).not.toBe(record.browserHost);
    }
  } finally {
    await context.close();
    await proxy.close();
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});
