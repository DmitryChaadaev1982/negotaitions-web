import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  e2eEmail,
  e2eId,
  getE2eRunId,
  query,
} from "./helpers/db";

const users: Array<{ id: string; email: string }> = [];
let adminCookie = "";
let nonAdminCookie = "";
let inactiveAdminCookie = "";

test.describe.configure({ mode: "serial" });

function requestOrigin() {
  const baseUrl = test.info().project.use.baseURL;
  if (!baseUrl) throw new Error("Playwright baseURL is required.");
  return new URL(baseUrl).origin;
}

async function createUser(
  label: string,
  status: "ACTIVE" | "BLOCKED" | "PENDING_APPROVAL",
  globalRole: "USER" | "ADMIN" = "USER",
) {
  const user = {
    id: e2eId(`stage313cp-${label}`),
    email: e2eEmail(`stage313cp-${label}`),
  };
  await query(
    `INSERT INTO "User"
       ("id", "email", "passwordHash", "name", "globalRole", "status", "preferredLocale", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, 'en', NOW())`,
    [user.id, user.email, "unused-e2e-hash", `Stage 3.13C-P ${label}`, globalRole, status],
  );
  users.push(user);
  return user;
}

async function sessionCookie(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await query(
    `INSERT INTO "UserSession"
       ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', NOW())`,
    [e2eId("stage313cp-session"), userId, tokenHash],
  );
  return `auth_session=${rawToken}`;
}

async function seedMessage(params: {
  label: string;
  messageType?: string;
  status?: string;
  provider?: string;
  locale?: string;
  recipient: string;
  providerMessageId?: string | null;
  subject?: string;
  text?: string;
  html?: string;
}) {
  const id = e2eId(`stage313cp-msg-${params.label}`);
  await query(
    `INSERT INTO "EmailMessage"
       ("id", "messageType", "category", "status", "recipientEmail",
        "recipientEmailNormalized", "fromAddress", "locale", "templateKey",
        "templateVersion", "renderedSubject", "renderedTextBody",
        "renderedHtmlBody", "idempotencyKey", "providerName",
        "lastProviderMessageId", "updatedAt")
     VALUES ($1, $2::"EmailMessageType", 'SECURITY', $3::"EmailMessageStatus", $4, $5,
             'no-reply@negotaitions.ru', $6, 'password-reset', '1.0.0',
             $7, $8, $9, $10, $11, $12, NOW())`,
    [
      id,
      params.messageType ?? "PASSWORD_RESET",
      params.status ?? "PENDING",
      params.recipient,
      params.recipient.toLowerCase(),
      params.locale ?? "en",
      params.subject ?? `Subject ${params.label}`,
      params.text ??
        `https://local.negotaitions.ru/reset-password?token=${"ab".repeat(32)}`,
      params.html ?? `<p>${params.label}</p>`,
      `stage313cp-journal:${getE2eRunId()}:${params.label}`,
      params.provider ?? "fake",
      params.providerMessageId ?? null,
    ],
  );
  return id;
}

test.beforeAll(async () => {
  const admin = await createUser("admin", "ACTIVE", "ADMIN");
  const nonAdmin = await createUser("user", "ACTIVE");
  const inactiveAdmin = await createUser("blocked-admin", "BLOCKED", "ADMIN");
  adminCookie = await sessionCookie(admin.id);
  nonAdminCookie = await sessionCookie(nonAdmin.id);
  inactiveAdminCookie = await sessionCookie(inactiveAdmin.id);
});

test.afterAll(async () => {
  const ids = users.map((user) => user.id);
  if (ids.length > 0) {
    await query(`DELETE FROM "User" WHERE "id" = ANY($1::text[])`, [ids]);
  }
  await query(`DELETE FROM "EmailMessage" WHERE "idempotencyKey" LIKE $1`, [
    `stage313cp-journal:${getE2eRunId()}:%`,
  ]);
  await query(
    `DELETE FROM "AdminActionLog"
     WHERE "action" = 'EMAIL_CONTENT_REVEALED'
       AND "createdAt" > NOW() - INTERVAL '2 hours'
       AND "adminUserId" = ANY($1::text[])`,
    [users.map((user) => user.id)],
  );
});

test("spoofed forwarding headers keep forgot-password public response stable", async ({
  request,
}) => {
  const email = e2eEmail("stage313cp-spoof");
  const headers: Array<Record<string, string>> = [
    {},
    { "x-forwarded-for": "198.51.100.1" },
    { "x-real-ip": "198.51.100.2" },
    { forwarded: "for=198.51.100.3" },
    { "cf-connecting-ip": "198.51.100.4" },
    { "true-client-ip": "198.51.100.5" },
    { "x-negotaitions-client-ip": "198.51.100.6" },
  ];
  const bodies = [];
  for (const extra of headers) {
    const response = await request.post("/api/auth/forgot-password", {
      headers: { Origin: requestOrigin(), ...extra },
      data: { email },
    });
    expect(response.status()).toBe(200);
    bodies.push(await response.json());
  }
  for (const body of bodies) {
    expect(body).toEqual(bodies[0]);
  }
});

test("disabled preview APIs return 404 while email journal remains available", async ({
  request,
  page,
}) => {
  expect((await request.get("/api/admin/email-preview")).status()).toBe(404);
  expect(
    (
      await request.post("/api/admin/email-preview", {
        headers: {
          Cookie: adminCookie,
          Origin: requestOrigin(),
        },
        data: { id: "x" },
      })
    ).status(),
  ).toBe(404);

  expect((await request.get("/api/admin/email-journal")).status()).toBe(401);
  expect(
    (
      await request.get("/api/admin/email-journal", {
        headers: { Cookie: nonAdminCookie },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get("/api/admin/email-journal", {
        headers: { Cookie: inactiveAdminCookie },
      })
    ).status(),
  ).toBe(403);

  const messageId = await seedMessage({
    label: "list",
    recipient: e2eEmail("stage313cp-list"),
    providerMessageId: "prov-msg-list-001",
  });

  const listResponse = await request.get("/api/admin/email-journal?pageSize=20", {
    headers: { Cookie: adminCookie },
  });
  expect(listResponse.status()).toBe(200);
  expect(listResponse.headers()["cache-control"]).toContain("no-store");
  const list = await listResponse.json();
  expect(Array.isArray(list.items)).toBe(true);
  const item = list.items.find((row: { id: string }) => row.id === messageId);
  expect(item).toBeTruthy();
  expect(item.recipientMasked).toMatch(/\*{3}/);
  expect(item).not.toHaveProperty("renderedTextBody");
  expect(JSON.stringify(item)).not.toContain("token=");

  await page.context().addCookies([
    {
      name: "auth_session",
      value: adminCookie.replace("auth_session=", ""),
      url: requestOrigin(),
    },
  ]);
  await page.goto("/admin");
  await expect(page.getByTestId("local-email-preview")).toHaveCount(0);
  await expect(page.getByText("Email foundation self-test")).toHaveCount(0);
  await page.goto("/admin/email");
  await expect(page.getByTestId("email-journal-page")).toBeVisible();
});

test("email journal detail reveal is audited and redacts reset tokens", async ({
  request,
}) => {
  const messageId = await seedMessage({
    label: "reveal",
    recipient: e2eEmail("stage313cp-reveal"),
  });

  expect(
    (
      await request.post(`/api/admin/email-journal/${messageId}/reveal`, {
        headers: {
          Cookie: nonAdminCookie,
          Origin: requestOrigin(),
        },
        data: {},
      })
    ).status(),
  ).toBe(403);

  const reveal = await request.post(`/api/admin/email-journal/${messageId}/reveal`, {
    headers: {
      Cookie: adminCookie,
      Origin: requestOrigin(),
    },
    data: {},
  });
  expect(reveal.status()).toBe(200);
  expect(reveal.headers()["cache-control"]).toContain("no-store");
  const payload = await reveal.json();
  expect(payload.available).toBe(true);
  expect(payload.redacted).toBe(true);
  expect(payload.text).toContain("[redacted]");
  expect(payload.text).not.toMatch(/token=[a-f0-9]{64}/i);

  const audits = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS "count"
     FROM "AdminActionLog"
     WHERE "action" = 'EMAIL_CONTENT_REVEALED'
       AND "metadata"::text LIKE $1`,
    [`%${messageId}%`],
  );
  expect(Number(audits[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
});
