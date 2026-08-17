import { createHash, randomBytes } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  e2eEmail,
  e2eId,
  getE2eRunId,
  hashE2ePassword,
  query,
} from "./helpers/db";

type AccountStatus = "PENDING_APPROVAL" | "ACTIVE" | "REJECTED" | "BLOCKED";
type TestUser = { id: string; email: string; status: AccountStatus };

const users: TestUser[] = [];
const ownedEmails = new Set<string>();
let adminCookie = "";
let nonAdminCookie = "";

test.describe.configure({ mode: "serial" });

function requestOrigin() {
  const baseUrl = test.info().project.use.baseURL;
  if (!baseUrl) throw new Error("Playwright baseURL is required.");
  return new URL(baseUrl).origin;
}

async function createUser(
  label: string,
  status: AccountStatus,
  globalRole: "USER" | "ADMIN" = "USER",
  passwordHash = "unused-e2e-hash",
): Promise<TestUser> {
  const user = {
    id: e2eId(`stage313c-${label}`),
    email: e2eEmail(`stage313c-${label}`),
    status,
  };
  await query(
    `INSERT INTO "User"
       ("id", "email", "passwordHash", "name", "globalRole", "status", "preferredLocale", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, 'en', NOW())`,
    [user.id, user.email, passwordHash, `Stage 3.13C ${label}`, globalRole, status],
  );
  users.push(user);
  ownedEmails.add(user.email);
  return user;
}

async function sessionCookie(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await query(
    `INSERT INTO "UserSession"
       ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', NOW())`,
    [e2eId("stage313c-session"), userId, tokenHash],
  );
  return `auth_session=${rawToken}`;
}

async function requestForgotPassword(
  request: APIRequestContext,
  email: string,
) {
  return request.post("/api/auth/forgot-password", {
    headers: { Origin: requestOrigin() },
    data: { email },
  });
}

async function countRows(table: "PasswordResetToken" | "EmailMessage", userId: string) {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS "count" FROM "${table}" WHERE "userId" = $1`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function seedPreviewMessages(count: number) {
  const fixtures = [
    {
      messageType: "PASSWORD_RESET",
      category: "SECURITY",
      templateKey: "password-reset",
    },
    {
      messageType: "ACCOUNT_RECOVERY_DENIED",
      category: "SECURITY",
      templateKey: "account-recovery-denied",
    },
    {
      messageType: "PASSWORD_CHANGED",
      category: "SECURITY",
      templateKey: "password-changed",
    },
    {
      messageType: "ADMIN_PENDING_APPROVAL",
      category: "TRANSACTIONAL",
      templateKey: "admin-pending-approval",
    },
  ] as const;
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = e2eId(`stage313c-message-${index}`);
    const fixture = fixtures[index % fixtures.length]!;
    ids.push(id);
    await query(
      `INSERT INTO "EmailMessage"
         ("id", "messageType", "category", "status", "recipientEmail",
          "recipientEmailNormalized", "fromAddress", "locale", "templateKey",
          "templateVersion", "renderedSubject", "renderedTextBody",
          "renderedHtmlBody", "idempotencyKey", "providerName", "updatedAt")
       VALUES ($1, $2::"EmailMessageType", $3::"EmailMessageCategory", 'PENDING', $4, $4,
               'no-reply@negotaitions.ru', 'en', $5, '1.0.0',
               $6, $7, $8, $9, 'fake', NOW())`,
      [
        id,
        fixture.messageType,
        fixture.category,
        `preview-${index}.${getE2eRunId()}@test.negotaitions.local`,
        fixture.templateKey,
        `Stage 3.13C subject ${index}`,
        `Stage 3.13C text ${index}`,
        `<p>Stage 3.13C HTML ${index}</p>`,
        `stage313c-preview:${getE2eRunId()}:${index}`,
      ],
    );
  }
  return ids;
}

test.beforeAll(async () => {
  const admin = await createUser("admin", "ACTIVE", "ADMIN");
  const nonAdmin = await createUser("non-admin", "ACTIVE");
  adminCookie = await sessionCookie(admin.id);
  nonAdminCookie = await sessionCookie(nonAdmin.id);
});

test.afterAll(async () => {
  const discoveredUsers =
    ownedEmails.size > 0
      ? await query<{ id: string }>(
          `SELECT "id" FROM "User" WHERE "email" = ANY($1::text[])`,
          [[...ownedEmails]],
        )
      : [];
  const userIds = [
    ...new Set([...users.map((user) => user.id), ...discoveredUsers.map((user) => user.id)]),
  ];
  if (userIds.length > 0) {
    const notificationPatterns = userIds.map(
      (userId) => `admin-pending-approval:${userId}:%`,
    );
    await query(
      `DELETE FROM "EmailMessage"
       WHERE "userId" = ANY($1::text[])
          OR "idempotencyKey" LIKE ANY($2::text[])`,
      [userIds, notificationPatterns],
    );
    await query(`DELETE FROM "User" WHERE "id" = ANY($1::text[])`, [userIds]);
  }
  await query(
    `DELETE FROM "EmailMessage" WHERE "idempotencyKey" LIKE $1`,
    [`stage313c-preview:${getE2eRunId()}:%`],
  );
});

test("forgot-password stays public and generic across account states", async ({
  request,
}) => {
  const active = await createUser("active", "ACTIVE");
  const blocked = await createUser("blocked", "BLOCKED");
  const rejected = await createUser("rejected", "REJECTED");
  const pending = await createUser("pending", "PENDING_APPROVAL");
  const unknownEmail = e2eEmail("stage313c-unknown");

  const responses = [];
  for (const email of [
    active.email,
    blocked.email,
    rejected.email,
    pending.email,
    unknownEmail,
  ]) {
    responses.push(await requestForgotPassword(request, email));
  }
  const payloads = await Promise.all(responses.map((response) => response.json()));
  for (const response of responses) expect(response.status()).toBe(200);
  for (const payload of payloads) expect(payload).toEqual(payloads[0]);
  expect(payloads[0]).toEqual({
    ok: true,
    messageKey: "auth.passwordResetRequestAccepted",
  });

  expect(await countRows("PasswordResetToken", active.id)).toBe(1);
  expect(await countRows("EmailMessage", active.id)).toBe(1);
  expect(await countRows("PasswordResetToken", blocked.id)).toBe(0);
  expect(await countRows("EmailMessage", blocked.id)).toBe(1);
  expect(await countRows("PasswordResetToken", rejected.id)).toBe(0);
  expect(await countRows("EmailMessage", rejected.id)).toBe(1);
  expect(await countRows("PasswordResetToken", pending.id)).toBe(0);
  expect(await countRows("EmailMessage", pending.id)).toBe(0);
  const unknownMessages = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS "count" FROM "EmailMessage"
     WHERE "recipientEmailNormalized" = $1`,
    [unknownEmail],
  );
  expect(Number(unknownMessages[0]?.count ?? 0)).toBe(0);
});

test("browser completes reset and revokes prior authentication", async ({
  page,
  request,
}) => {
  const oldPassword = "Stage313C-old-password!";
  const newPassword = "Stage313C-new-password!";
  const passwordHash = await hashE2ePassword(oldPassword);
  const user = await createUser("browser-reset", "ACTIVE", "USER", passwordHash);

  const sessionIds = [e2eId("stage313c-reset-session"), e2eId("stage313c-reset-session")];
  await query(
    `INSERT INTO "UserSession"
       ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
     VALUES
       ($1, $3, $4, NOW() + INTERVAL '1 day', NOW()),
       ($2, $3, $5, NOW() + INTERVAL '1 day', NOW())`,
    [
      sessionIds[0],
      sessionIds[1],
      user.id,
      createHash("sha256").update(randomBytes(32)).digest("hex"),
      createHash("sha256").update(randomBytes(32)).digest("hex"),
    ],
  );

  const forgotResponse = await requestForgotPassword(request, user.email);
  expect(forgotResponse.status()).toBe(200);
  const resetMessages = await query<{
    id: string;
    userId: string | null;
    relatedTokenId: string | null;
    recipientEmailNormalized: string;
    renderedTextBody: string | null;
    sensitivePayloadCiphertext: string | null;
    sensitivePayloadNonce: string | null;
    metadata: unknown;
  }>(
    `SELECT "id", "userId", "relatedTokenId", "recipientEmailNormalized",
            "renderedTextBody", "sensitivePayloadCiphertext", "sensitivePayloadNonce",
            "metadata"
     FROM "EmailMessage"
     WHERE "userId" = $1 AND "messageType" = 'PASSWORD_RESET'
     ORDER BY "createdAt" DESC
     LIMIT 1`,
    [user.id],
  );
  expect(resetMessages[0]?.renderedTextBody).toBeNull();
  expect(resetMessages[0]?.sensitivePayloadCiphertext).toBeTruthy();
  expect(resetMessages[0]?.sensitivePayloadNonce).toBeTruthy();

  const { decryptSensitivePayload } = await import(
    "@/lib/email/sensitive-payload"
  );
  const msg = resetMessages[0]!;
  const metadata =
    msg.metadata && typeof msg.metadata === "object"
      ? (msg.metadata as Record<string, unknown>)
      : {};
  const credentialGeneration =
    typeof metadata.credentialGeneration === "number"
      ? metadata.credentialGeneration
      : 0;
  const payload = decryptSensitivePayload(
    {
      ciphertext: msg.sensitivePayloadCiphertext!,
      nonce: msg.sensitivePayloadNonce!,
    },
    {
      messageId: msg.id,
      tokenId: msg.relatedTokenId!,
      userId: msg.userId!,
      credentialGeneration,
      recipientNormalized: msg.recipientEmailNormalized,
    },
  );
  const resetToken = payload.rawToken;
  expect(resetToken).toMatch(/^[a-f0-9]{64}$/);

  // Legacy query-token links must be rejected (already entered request URI).
  await page.goto("/reset-password?token=legacy-query-value");
  await expect(page.getByTestId("reset-password-invalid-link")).toBeVisible();

  // Fragment tokens are client-only; scrub address bar after bootstrap.
  await page.goto(`/reset-password#token=${resetToken}`);
  await page.waitForFunction(() => !window.location.hash.includes("token="));
  expect(page.url()).not.toContain("token=");
  await page.locator("#password").fill(newPassword);
  await page.locator("#confirmPassword").fill(newPassword);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/login\?passwordReset=success$/);
  await expect(page.getByRole("status")).toBeVisible();

  const sessionsAfterReset = await query<{ id: string }>(
    `SELECT "id" FROM "UserSession" WHERE "userId" = $1`,
    [user.id],
  );
  expect(sessionsAfterReset).toHaveLength(0);
  const resetTokenRows = await query<{ usedAt: string | null }>(
    `SELECT "usedAt" FROM "PasswordResetToken" WHERE "userId" = $1`,
    [user.id],
  );
  expect(resetTokenRows).toHaveLength(1);
  expect(resetTokenRows[0]?.usedAt).not.toBeNull();
  const changedMessages = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS "count"
     FROM "EmailMessage"
     WHERE "userId" = $1 AND "messageType" = 'PASSWORD_CHANGED'`,
    [user.id],
  );
  expect(Number(changedMessages[0]?.count ?? 0)).toBe(1);

  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(oldPassword);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/login\?passwordReset=success$/);
  await expect(page.locator("form p.text-red-400")).toBeVisible();

  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(newPassword);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);

  const priorSessions = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS "count"
     FROM "UserSession"
     WHERE "id" = ANY($1::text[])`,
    [sessionIds],
  );
  expect(Number(priorSessions[0]?.count ?? 0)).toBe(0);
});

test("reset fragments scrub before strict parsing and never enter HTTP requests", async ({
  page,
}) => {
  const validToken = randomBytes(32).toString("hex");
  const otherToken = randomBytes(32).toString("hex");
  const navigationUrls: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest()) navigationUrls.push(request.url());
  });

  await page.goto(`/reset-password#token=${validToken}`);
  await expect(page.locator("#password")).toBeVisible();
  await page.waitForFunction(() => window.location.hash === "");
  const copiedUrl = await page.evaluate(() => window.location.href);
  expect(copiedUrl).not.toContain("#");
  expect(copiedUrl).not.toContain("token=");
  expect(navigationUrls.every((url) => !url.includes(validToken))).toBe(true);

  await page.reload();
  await expect(page.getByTestId("reset-password-invalid-link")).toBeVisible();

  const invalidFragments = [
    `token=bad&token=${validToken}`,
    `token=${validToken}&token=bad`,
    `token=${validToken}&token=${otherToken}`,
    "token=%E0%A4%A",
    "token=",
    `token=${validToken}&source=email`,
    `source=email&token=${validToken}`,
  ];
  for (const fragment of invalidFragments) {
    await page.goto(`/reset-password#${fragment}`);
    await page.waitForFunction(() => window.location.hash === "");
    await expect(page.getByTestId("reset-password-invalid-link")).toBeVisible();
    expect(page.url()).not.toContain("#");
  }

  await page.goto("/reset-password?token=");
  await expect(page.getByTestId("reset-password-invalid-link")).toBeVisible();
  await page.goto("/reset-password?token=legacy-query-value");
  await expect(page.getByTestId("reset-password-invalid-link")).toBeVisible();
});

test("registration notifies only active database admins", async ({ page }) => {
  const activeAdmin = await createUser("registration-admin-active", "ACTIVE", "ADMIN");
  const blockedAdmin = await createUser("registration-admin-blocked", "BLOCKED", "ADMIN");
  const rejectedAdmin = await createUser("registration-admin-rejected", "REJECTED", "ADMIN");
  const pendingAdmin = await createUser(
    "registration-admin-pending",
    "PENDING_APPROVAL",
    "ADMIN",
  );
  const registrationEmail = e2eEmail("stage313c-browser-registration");
  ownedEmails.add(registrationEmail);
  const registrationPassword = "Stage313C-registration-password!";

  const activeAdminCountRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS "count"
     FROM "User"
     WHERE "globalRole" = 'ADMIN' AND "status" = 'ACTIVE'`,
  );
  const activeAdminCount = Number(activeAdminCountRows[0]?.count ?? 0);

  await page.goto("/register");
  await page.locator("#name").fill("Stage 3.13C Pending User");
  await page.locator("#email").fill(registrationEmail);
  await page.locator("#password").fill(registrationPassword);
  await page.locator("#confirmPassword").fill(registrationPassword);
  await page.locator("#preferredLocale").selectOption("en");
  await page.getByTestId("consent-terms-privacy").check();
  await page.getByTestId("consent-personal-data-processing").check();
  await page.getByTestId("consent-training-session-notice").check();
  await page.locator('form button[type="submit"]').click();

  await expect(page).toHaveURL(/\/pending-approval$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Account pending approval",
  );

  const registeredUsers = await query<{ id: string; status: string }>(
    `SELECT "id", "status" FROM "User" WHERE "email" = $1`,
    [registrationEmail],
  );
  expect(registeredUsers).toHaveLength(1);
  const registeredUser = registeredUsers[0]!;
  expect(registeredUser.status).toBe("PENDING_APPROVAL");

  const notifications = await query<{
    userId: string | null;
    globalRole: string | null;
    status: string | null;
    category: string;
    idempotencyKey: string;
  }>(
    `SELECT m."userId", u."globalRole", u."status", m."category", m."idempotencyKey"
     FROM "EmailMessage" m
     LEFT JOIN "User" u ON u."id" = m."userId"
     WHERE m."messageType" = 'ADMIN_PENDING_APPROVAL'
       AND m."idempotencyKey" LIKE $1
     ORDER BY m."userId"`,
    [`admin-pending-approval:${registeredUser.id}:%`],
  );
  expect(notifications).toHaveLength(activeAdminCount);
  expect(notifications.some((message) => message.userId === activeAdmin.id)).toBe(true);
  for (const notification of notifications) {
    expect(notification.globalRole).toBe("ADMIN");
    expect(notification.status).toBe("ACTIVE");
    expect(notification.category).toBe("TRANSACTIONAL");
    expect(notification.idempotencyKey).toBe(
      `admin-pending-approval:${registeredUser.id}:${notification.userId}`,
    );
  }
  for (const excluded of [blockedAdmin, rejectedAdmin, pendingAdmin]) {
    expect(notifications.some((message) => message.userId === excluded.id)).toBe(false);
  }
});

test("local preview requires active admin and explicit bounded reveal", async ({
  request,
}) => {
  await seedPreviewMessages(22);

  expect((await request.get("/api/admin/email-preview")).status()).toBe(401);
  expect(
    (
      await request.get("/api/admin/email-preview", {
        headers: { Cookie: nonAdminCookie },
      })
    ).status(),
  ).toBe(403);

  const listResponse = await request.get("/api/admin/email-preview?limit=20", {
    headers: { Cookie: adminCookie },
  });
  expect(listResponse.status()).toBe(200);
  const list = (await listResponse.json()) as {
    items: Array<Record<string, unknown> & { id: string; recipient: string }>;
  };
  expect(list.items).toHaveLength(20);
  expect(list.items[0]).not.toHaveProperty("subject");
  expect(list.items[0]).not.toHaveProperty("text");
  expect(list.items[0]).not.toHaveProperty("html");
  expect(list.items[0]?.recipient).toMatch(/^[^@]*\*{3}@[^@]*\*{3}/);

  expect(
    (
      await request.get("/api/admin/email-preview?limit=21", {
        headers: { Cookie: adminCookie },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.get("/api/admin/email-preview?type=SYSTEM_TEST", {
        headers: { Cookie: adminCookie },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/admin/email-preview", {
        headers: {
          Cookie: adminCookie,
          Origin: "https://cross-origin.invalid",
        },
        data: { id: list.items[0]!.id },
      })
    ).status(),
  ).toBe(403);

  const revealResponse = await request.post("/api/admin/email-preview", {
    headers: {
      Cookie: adminCookie,
      Origin: requestOrigin(),
    },
    data: { id: list.items[0]!.id },
  });
  expect(revealResponse.status()).toBe(200);
  const revealed = await revealResponse.json();
  expect(Object.keys(revealed).sort()).toEqual(["html", "subject", "text"]);
  expect(revealed.subject).toContain("Stage 3.13C subject");
  expect(revealed.text).toContain("Stage 3.13C text");
  expect(revealed.html).toContain("<p>Stage 3.13C HTML");
});
