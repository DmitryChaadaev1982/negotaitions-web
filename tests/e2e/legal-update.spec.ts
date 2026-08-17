import { expect, test } from "@playwright/test";

import {
  createActiveUser,
  createSnapshotJoinFixture,
  createTestEvent,
  createUserSessionCookie,
  e2eEmail,
  insertLegacyV1Consents,
  listUserConsents,
  query,
} from "./helpers/db";

function baseUrl() {
  return test.info().project.use.baseURL ?? "http://127.0.0.1:3100";
}

async function addAuthCookie(
  page: import("@playwright/test").Page,
  cookieHeader: string,
) {
  await page.context().addCookies([
    {
      name: "auth_session",
      value: cookieHeader.slice("auth_session=".length),
      url: baseUrl(),
    },
  ]);
}

async function setLocale(
  page: import("@playwright/test").Page,
  locale: "ru" | "en",
) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("negotaitions_locale", value);
    document.cookie = `negotaitions_locale=${value};path=/;max-age=31536000;samesite=lax`;
  }, locale);
  await page.context().addCookies([
    {
      name: "negotaitions_locale",
      value: locale,
      url: baseUrl(),
    },
  ]);
}

async function loginWithPassword(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('form button[type="submit"]').click();
}

async function confirmCurrentLegalRelease(
  page: import("@playwright/test").Page,
) {
  await page.getByTestId("consent-terms-privacy").check();
  await page.getByTestId("consent-personal-data-processing").check();
  await page.getByTestId("consent-training-session-notice").check();
  await page.getByTestId("legal-update-confirm").click();
}

test("existing v1-only user is gated, can review documents, and cannot continue until all current items are confirmed", async ({
  page,
}) => {
  const password = "LegalUpdate-v1-user!";
  const user = await createActiveUser({
    password,
    preferredLocale: "ru",
    legalRelease: "v1",
  });

  try {
    await setLocale(page, "ru");
    await page.goto("/login?returnUrl=%2Fdashboard");
    await loginWithPassword(page, user.email, password);
    await expect(page).toHaveURL(/\/legal-update/);
    await expect(page.getByTestId("legal-update-card")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Обновлены условия использования и обработки данных",
    );

    await expect(page.getByRole("link", { name: "Пользовательское соглашение" }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Политика обработки персональных данных" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Согласие на обработку персональных данных" }).first(),
    ).toBeVisible();
    await expect(page.locator("body")).toContainText(
      "Я даю согласие на обработку моих персональных данных на условиях документа «Согласие на обработку персональных данных».",
    );
    await expect(page.locator("body")).not.toContainText(
      "на условиях Согласие на обработку",
    );
    await expect(
      page.getByRole("link", { name: "Уведомление об ИИ и внешних сервисах" }).first(),
    ).toBeVisible();

    const privacyLink = page.getByRole("link", { name: "Политика обработки персональных данных" }).first();
    await expect(privacyLink).toHaveAttribute("href", /returnContext=legal-update/);
    await privacyLink.click();
    await expect(page).toHaveURL(/\/privacy/);
    await expect(page.getByTestId("legal-document-header")).toBeVisible();
    await expect(page.getByTestId("legal-document-return")).toContainText(
      "Вернуться к подтверждению",
    );
    await page.getByTestId("legal-document-return").click();
    await expect(page).toHaveURL(/\/legal-update/);

    await page.getByTestId("legal-update-confirm").click();
    await expect(page).toHaveURL(/\/legal-update/);

    await confirmCurrentLegalRelease(page);
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);

    const consents = await listUserConsents(user.id);
    const types = consents.map((row) => row.consentType);
    expect(types).toEqual(
      expect.arrayContaining([
        "TERMS_PRIVACY_V1",
        "MVP_DATA_LIMITATION_V1",
        "EXTERNAL_INFRASTRUCTURE_V1",
        "TERMS_PRIVACY_ACK_V2",
        "PERSONAL_DATA_PROCESSING_V2",
        "TRAINING_SESSION_NOTICE_V2",
      ]),
    );
    expect(consents.filter((row) => row.consentType.endsWith("_V1")).every((row) => row.version === "1")).toBe(true);
    expect(
      consents
        .filter((row) =>
          [
            "TERMS_PRIVACY_ACK_V2",
            "PERSONAL_DATA_PROCESSING_V2",
            "TRAINING_SESSION_NOTICE_V2",
          ].includes(row.consentType),
        )
        .every((row) => row.version === "2"),
    ).toBe(true);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
    await expect(page.getByTestId("legal-update-card")).toHaveCount(0);
  } finally {
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});

test("safe returnUrl is honoured and external returnUrl falls back to dashboard", async ({
  page,
}) => {
  const password = "LegalUpdate-return!";
  const safeUser = await createActiveUser({
    password,
    preferredLocale: "en",
    legalRelease: "v1",
  });
  const unsafeUser = await createActiveUser({
    password,
    preferredLocale: "en",
    legalRelease: "v1",
  });

  try {
    await setLocale(page, "en");
    await page.goto("/login?returnUrl=%2Fcases");
    await loginWithPassword(page, safeUser.email, password);
    await expect(page).toHaveURL(/\/legal-update/);
    await confirmCurrentLegalRelease(page);
    await expect(page).toHaveURL(/\/cases(?:\?.*)?$/);

    await page.context().clearCookies();
    const cookieHeader = await createUserSessionCookie(unsafeUser.id, {
      grantCurrentLegalRelease: false,
    });
    await addAuthCookie(page, cookieHeader);
    await setLocale(page, "en");
    await page.goto("/legal-update?returnUrl=https://evil.example");
    await expect(page.getByTestId("legal-update-card")).toBeVisible();
    await confirmCurrentLegalRelease(page);
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
    expect(page.url()).not.toContain("evil.example");
  } finally {
    await query(`DELETE FROM "User" WHERE "id" IN ($1, $2)`, [
      safeUser.id,
      unsafeUser.id,
    ]);
  }
});

test("new v2 registration is not gated and public legal routes stay public", async ({
  page,
}) => {
  const email = e2eEmail("legal-update-register");
  const currentUser = await createActiveUser({
    password: "LegalUpdate-current!",
    preferredLocale: "en",
    legalRelease: "current",
  });

  try {
    await setLocale(page, "en");
    await page.goto("/register");
    await page.locator("#name").fill("Legal Update Registrant");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill("LegalUpdate-register!");
    await page.locator("#confirmPassword").fill("LegalUpdate-register!");
    await page.getByTestId("consent-terms-privacy").check();
    await page.getByTestId("consent-personal-data-processing").check();
    await page.getByTestId("consent-training-session-notice").check();
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/pending-approval$/);
    await expect(page).not.toHaveURL(/\/legal-update/);

    const registered = await query<{ id: string }>(
      `SELECT "id" FROM "User" WHERE "email" = $1`,
      [email],
    );
    const consents = await listUserConsents(registered[0]!.id);
    expect(consents.map((row) => row.consentType).sort()).toEqual([
      "PERSONAL_DATA_PROCESSING_V2",
      "TERMS_PRIVACY_ACK_V2",
      "TRAINING_SESSION_NOTICE_V2",
    ].sort());
    expect(consents.every((row) => row.version === "2")).toBe(true);
    expect(consents.some((row) => row.consentType.endsWith("_V1"))).toBe(false);

    await page.goto("/login?returnUrl=%2Fdashboard");
    await loginWithPassword(page, currentUser.email, "LegalUpdate-current!");
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);

    await page.context().clearCookies();
    for (const path of [
      "/privacy",
      "/terms",
      "/cookie-policy",
      "/data-processing-consent",
      "/ai-processing-notice",
    ]) {
      const response = await page.goto(path);
      expect(response?.status()).not.toBe(401);
      await expect(page.getByTestId("legal-document-meta")).toContainText("2");
    }
  } finally {
    await query(`DELETE FROM "User" WHERE "email" = $1 OR "id" = $2`, [
      email,
      currentUser.id,
    ]);
  }
});

test("logout remains possible from the legal-update gate and v1 history stays intact", async ({
  page,
}) => {
  const user = await createActiveUser({
    preferredLocale: "ru",
    legalRelease: "none",
  });
  await insertLegacyV1Consents(user.id);
  const cookieHeader = await createUserSessionCookie(user.id, {
    grantCurrentLegalRelease: false,
  });

  try {
    await addAuthCookie(page, cookieHeader);
    await setLocale(page, "ru");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/legal-update/);
    const before = await listUserConsents(user.id);
    expect(before.map((row) => row.consentType).sort()).toEqual([
      "EXTERNAL_INFRASTRUCTURE_V1",
      "MVP_DATA_LIMITATION_V1",
      "TERMS_PRIVACY_V1",
    ]);

    await page.getByTestId("legal-update-logout").click();
    await expect(page).toHaveURL(/\/login$/);

    const after = await listUserConsents(user.id);
    expect(after).toEqual(before);
  } finally {
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});

test("v1-only authenticated user is gated on fresh room, lobby, and join entry", async ({
  page,
}) => {
  const user = await createActiveUser({
    preferredLocale: "en",
    legalRelease: "v1",
  });
  const cookieHeader = await createUserSessionCookie(user.id, {
    grantCurrentLegalRelease: false,
  });
  const event = await createTestEvent();
  const joinFixture = await createSnapshotJoinFixture();
  const roomId = "e2e-legal-room-entry";

  try {
    await addAuthCookie(page, cookieHeader);
    await setLocale(page, "en");

    await page.goto(`/room/${roomId}`);
    await expect(page).toHaveURL(/\/legal-update/);
    await expect(page.getByTestId("legal-update-card")).toBeVisible();
    expect(page.url()).not.toContain(roomId);

    await page.goto(`/events/${event.id}/lobby`);
    await expect(page).toHaveURL(/\/legal-update/);
    expect(page.url()).not.toContain("hostToken");
    expect(decodeURIComponent(new URL(page.url()).searchParams.get("returnUrl") ?? "")).toBe(
      `/events/${event.id}/lobby`,
    );

    await page.goto(`/join/${joinFixture.joinToken}`);
    await expect(page).toHaveURL(/\/legal-update/);
    expect(page.url()).not.toContain(joinFixture.joinToken);
    const claimed = await query<{ userId: string | null }>(
      `SELECT "userId" FROM "SessionParticipant" WHERE "joinToken" = $1`,
      [joinFixture.joinToken],
    );
    expect(claimed[0]?.userId).toBeNull();
  } finally {
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});

test("raw invite tokens are not reflected in the legal-update URL", async ({
  page,
}) => {
  const user = await createActiveUser({
    preferredLocale: "en",
    legalRelease: "v1",
  });
  const cookieHeader = await createUserSessionCookie(user.id, {
    grantCurrentLegalRelease: false,
  });
  const event = await createTestEvent();
  const joinFixture = await createSnapshotJoinFixture();
  const hostToken = event.hostToken;
  const participantToken = "RAW_PARTICIPANT_TOKEN_SECRET";
  const joinToken = joinFixture.joinToken;
  const roomId = "e2e-legal-token-room";

  try {
    await addAuthCookie(page, cookieHeader);
    await setLocale(page, "en");

    await page.goto(`/join/${joinToken}`);
    await expect(page).toHaveURL(/\/legal-update/);
    expect(page.url()).not.toContain(joinToken);
    expect(page.url()).not.toContain("returnUrl");

    await page.goto(
      `/events/${event.id}/lobby?hostToken=${encodeURIComponent(hostToken)}&participantToken=${encodeURIComponent(participantToken)}`,
    );
    await expect(page).toHaveURL(/\/legal-update/);
    expect(page.url()).not.toContain(hostToken);
    expect(page.url()).not.toContain(participantToken);
    expect(page.url()).not.toContain("hostToken");
    expect(page.url()).not.toContain("participantToken");

    await page.goto(
      `/room/${roomId}?joinToken=${encodeURIComponent(joinToken)}`,
    );
    await expect(page).toHaveURL(/\/legal-update/);
    expect(page.url()).not.toContain(joinToken);
    expect(page.url()).not.toContain("joinToken");

    await page.goto(
      `/legal-update?returnUrl=${encodeURIComponent(`/join/${joinToken}`)}`,
    );
    await expect(page).toHaveURL(/\/legal-update$/);
    expect(page.url()).not.toContain(joinToken);
  } finally {
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});

test("v2-complete user can enter room and lobby without the legal-update gate", async ({
  page,
}) => {
  const user = await createActiveUser({
    preferredLocale: "en",
    legalRelease: "current",
  });
  const cookieHeader = await createUserSessionCookie(user.id);
  const event = await createTestEvent();
  const missingRoomId = "e2e-legal-v2-missing-room";

  try {
    await addAuthCookie(page, cookieHeader);
    await setLocale(page, "en");

    await page.goto(`/room/${missingRoomId}`);
    await expect(page).not.toHaveURL(/\/legal-update/);
    await expect(page.getByTestId("legal-update-card")).toHaveCount(0);

    await page.goto(`/events/${event.id}/lobby`);
    await expect(page).not.toHaveURL(/\/legal-update/);
    await expect(page.getByTestId("legal-update-card")).toHaveCount(0);
  } finally {
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});

test("anonymous visitor cannot open or accept the current legal release", async ({
  page,
}) => {
  await setLocale(page, "en");
  await page.goto("/legal-update");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("legal-update-card")).toHaveCount(0);
  await expect(page.getByTestId("legal-update-confirm")).toHaveCount(0);
});

test("login with a token-bearing returnUrl does not copy the secret into legal-update", async ({
  page,
}) => {
  const password = "LegalUpdate-join-token!";
  const user = await createActiveUser({
    password,
    preferredLocale: "en",
    legalRelease: "v1",
  });
  const joinFixture = await createSnapshotJoinFixture();

  try {
    await setLocale(page, "en");
    await page.goto(
      `/login?returnUrl=${encodeURIComponent(`/join/${joinFixture.joinToken}`)}`,
    );
    await loginWithPassword(page, user.email, password);
    await expect(page).toHaveURL(/\/legal-update/);
    expect(page.url()).not.toContain(joinFixture.joinToken);
    const claimed = await query<{ userId: string | null }>(
      `SELECT "userId" FROM "SessionParticipant" WHERE "joinToken" = $1`,
      [joinFixture.joinToken],
    );
    expect(claimed[0]?.userId).toBeNull();
  } finally {
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});

test("EN legal-update document links open EN legal pages", async ({ page }) => {
  const user = await createActiveUser({
    preferredLocale: "en",
    legalRelease: "v1",
  });
  const cookieHeader = await createUserSessionCookie(user.id, {
    grantCurrentLegalRelease: false,
  });

  try {
    await addAuthCookie(page, cookieHeader);
    await setLocale(page, "en");
    await page.goto("/legal-update");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Updated terms of use and data processing",
    );
    await expect(page.getByRole("link", { name: "Terms of Use" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Policy" }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Personal Data Processing Consent" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "AI & External Services Notice" }).first(),
    ).toBeVisible();

    const privacyLink = page.getByRole("link", { name: "Privacy Policy" }).first();
    await expect(privacyLink).toHaveAttribute("href", /returnContext=legal-update/);
    await privacyLink.click();
    await expect(page).toHaveURL(/\/privacy/);
    await expect(page.getByTestId("legal-document")).toHaveAttribute(
      "data-legal-locale",
      "en",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy");
    await expect(page.locator("body")).not.toContainText("ПереговорИИ (NegotAItions)");
    await expect(page.getByTestId("legal-document-return")).toContainText(
      "Back to confirmation",
    );
    await page.getByTestId("legal-document-return").click();
    await expect(page).toHaveURL(/\/legal-update/);
  } finally {
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});

