import { createHash, randomBytes } from "crypto";

import { expect, test, type Page } from "@playwright/test";

import { query } from "./helpers/db";

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function createUser(input: {
  email: string;
  name: string;
  status?: "PENDING_APPROVAL" | "ACTIVE" | "REJECTED" | "BLOCKED";
  globalRole?: "USER" | "ADMIN";
}) {
  const id = uid("user");
  const rows = await query<{ id: string }>(
    `INSERT INTO "User"
       ("id", "email", "passwordHash", "name", "role", "globalRole", "status", "updatedAt")
     VALUES ($1, $2, 'hash', $3, 'PARTICIPANT', $4, $5, NOW())
     ON CONFLICT ("email") DO UPDATE
       SET "name" = EXCLUDED."name",
           "globalRole" = EXCLUDED."globalRole",
           "status" = EXCLUDED."status",
           "updatedAt" = NOW()
     RETURNING "id"`,
    [id, input.email, input.name, input.globalRole ?? "USER", input.status ?? "ACTIVE"],
  );
  return rows[0]!.id;
}

async function createUserSession(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await query(
    `INSERT INTO "UserSession"
       ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [uid("sess"), userId, tokenHash, expiresAt],
  );

  return rawToken;
}

async function createCookieForUser(userId: string) {
  const token = await createUserSession(userId);
  return `auth_session=${token}`;
}

async function cleanupUsers() {
  await query(`DELETE FROM "User" WHERE "email" LIKE '%@admin-users-test.negotaitions'`);
}

async function getUserByEmail(email: string) {
  const rows = await query<{
    id: string;
    status: string;
    globalRole: string;
    approvedAt: string | null;
    approvedByUserId: string | null;
    rejectedAt: string | null;
    rejectedByUserId: string | null;
    blockedAt: string | null;
    blockedByUserId: string | null;
  }>(
    `SELECT "id", "status", "globalRole", "approvedAt", "approvedByUserId",
            "rejectedAt", "rejectedByUserId", "blockedAt", "blockedByUserId"
     FROM "User" WHERE "email" = $1`,
    [email],
  );
  return rows[0] ?? null;
}

async function getLatestAdminAction(targetUserId: string) {
  const rows = await query<{ action: string }>(
    `SELECT "action"
     FROM "AdminActionLog"
     WHERE "targetUserId" = $1
     ORDER BY "createdAt" DESC
     LIMIT 1`,
    [targetUserId],
  );
  return rows[0]?.action ?? null;
}

async function clickAction(page: Page, email: string, buttonLabel: string) {
  const row = page.locator("tr", { hasText: email });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: buttonLabel }).click();
}

function acceptPrompt(page: Page, text = "ok") {
  page.once("dialog", async (dialog) => {
    if (dialog.type() === "prompt") {
      await dialog.accept(text);
      return;
    }
    await dialog.accept();
  });
}

function acceptConfirmThenPrompt(page: Page, text = "ok") {
  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  page.once("dialog", async (dialog) => {
    if (dialog.type() === "prompt") {
      await dialog.accept(text);
      return;
    }
    await dialog.accept();
  });
}

test.describe("Phase 2 admin user management", () => {
  let adminUserId: string;
  let adminCookie: string;
  let nonAdminCookie: string;

  test.beforeAll(async () => {
    await cleanupUsers();

    adminUserId = await createUser({
      email: "admin@admin-users-test.negotaitions",
      name: "Admin Operator",
      status: "ACTIVE",
      globalRole: "ADMIN",
    });
    adminCookie = await createCookieForUser(adminUserId);

    const nonAdminId = await createUser({
      email: "active@admin-users-test.negotaitions",
      name: "Active User",
      status: "ACTIVE",
      globalRole: "USER",
    });
    nonAdminCookie = await createCookieForUser(nonAdminId);
  });

  test.afterAll(async () => {
    await cleanupUsers();
  });

  test("admin can open /admin/users", async ({ page }) => {
    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User management" })).toBeVisible();
  });

  test("non-admin cannot open /admin/users", async ({ request }) => {
    const response = await request.get("/admin/users", {
      headers: { Cookie: nonAdminCookie },
      maxRedirects: 0,
    });
    expect([302, 307]).toContain(response.status());
    const location = response.headers()["location"] ?? "";
    expect(location).toContain("/dashboard?error=access_denied");
  });

  test("unauthenticated user is redirected from /admin/users to login", async ({
    request,
  }) => {
    const response = await request.get("/admin/users", { maxRedirects: 0 });
    expect([302, 307]).toContain(response.status());
    const location = response.headers()["location"] ?? "";
    expect(location).toContain("/login?returnUrl=%2Fadmin%2Fusers");
  });

  test("pending user appears in pending approval filter", async ({ page }) => {
    const email = "pending@admin-users-test.negotaitions";
    await createUser({
      email,
      name: "Pending User",
      status: "PENDING_APPROVAL",
      globalRole: "USER",
    });

    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users?filter=pending");
    await expect(page.getByText(email)).toBeVisible();
  });

  test("admin approves pending user and writes USER_APPROVED log", async ({ page }) => {
    const email = "approve@admin-users-test.negotaitions";
    const targetId = await createUser({
      email,
      name: "Approve Target",
      status: "PENDING_APPROVAL",
      globalRole: "USER",
    });

    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users?filter=pending");
    acceptPrompt(page, "approved");
    await clickAction(page, email, "Approve");

    await expect
      .poll(async () => (await getUserByEmail(email))?.status)
      .toBe("ACTIVE");
    const user = await getUserByEmail(email);
    expect(user?.approvedAt).toBeTruthy();
    expect(user?.approvedByUserId).toBe(adminUserId);
    await expect
      .poll(async () => getLatestAdminAction(targetId))
      .toBe("USER_APPROVED");
  });

  test("admin rejects pending user and writes USER_REJECTED log", async ({ page }) => {
    const email = "reject@admin-users-test.negotaitions";
    const targetId = await createUser({
      email,
      name: "Reject Target",
      status: "PENDING_APPROVAL",
      globalRole: "USER",
    });

    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users?filter=pending");
    acceptConfirmThenPrompt(page, "rejected");
    await clickAction(page, email, "Reject");

    await expect
      .poll(async () => (await getUserByEmail(email))?.status)
      .toBe("REJECTED");
    const user = await getUserByEmail(email);
    expect(user?.rejectedAt).toBeTruthy();
    expect(user?.rejectedByUserId).toBe(adminUserId);
    await expect
      .poll(async () => getLatestAdminAction(targetId))
      .toBe("USER_REJECTED");
  });

  test("admin blocks active user and blocked user cannot access dashboard", async ({
    page,
    request,
  }) => {
    const email = "block@admin-users-test.negotaitions";
    const targetId = await createUser({
      email,
      name: "Block Target",
      status: "ACTIVE",
      globalRole: "USER",
    });
    const blockedCookie = await createCookieForUser(targetId);

    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users?filter=active");
    acceptConfirmThenPrompt(page, "blocked");
    await clickAction(page, email, "Block");

    await expect
      .poll(async () => (await getUserByEmail(email))?.status)
      .toBe("BLOCKED");
    const user = await getUserByEmail(email);
    expect(user?.blockedAt).toBeTruthy();
    expect(user?.blockedByUserId).toBe(adminUserId);
    await expect
      .poll(async () => getLatestAdminAction(targetId))
      .toBe("USER_BLOCKED");

    const response = await request.get("/dashboard", {
      headers: { Cookie: blockedCookie },
      maxRedirects: 0,
    });
    expect([302, 307]).toContain(response.status());
    expect(response.headers()["location"] ?? "").toContain("/account/blocked");
  });

  test("admin unblocks blocked user", async ({ page }) => {
    const email = "unblock@admin-users-test.negotaitions";
    const targetId = await createUser({
      email,
      name: "Unblock Target",
      status: "BLOCKED",
      globalRole: "USER",
    });

    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users?filter=blocked");
    acceptPrompt(page, "unblocked");
    await clickAction(page, email, "Unblock");

    await expect
      .poll(async () => (await getUserByEmail(email))?.status)
      .toBe("ACTIVE");
    const user = await getUserByEmail(email);
    expect(user?.blockedAt).toBeNull();
    expect(user?.blockedByUserId).toBeNull();
    await expect
      .poll(async () => getLatestAdminAction(targetId))
      .toBe("USER_UNBLOCKED");
  });

  test("admin makes user admin and writes USER_MADE_ADMIN log", async ({ page }) => {
    const email = "make-admin@admin-users-test.negotaitions";
    const targetId = await createUser({
      email,
      name: "Make Admin Target",
      status: "ACTIVE",
      globalRole: "USER",
    });

    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users");
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await clickAction(page, email, "Make admin");

    await expect
      .poll(async () => (await getUserByEmail(email))?.globalRole)
      .toBe("ADMIN");
    await expect
      .poll(async () => getLatestAdminAction(targetId))
      .toBe("USER_MADE_ADMIN");
  });

  test("admin removes admin from non-bootstrap admin and writes USER_ADMIN_REMOVED log", async ({
    page,
  }) => {
    const email = "remove-admin@admin-users-test.negotaitions";
    const targetId = await createUser({
      email,
      name: "Remove Admin Target",
      status: "ACTIVE",
      globalRole: "ADMIN",
    });

    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users?filter=admins");
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await clickAction(page, email, "Remove admin");

    await expect
      .poll(async () => (await getUserByEmail(email))?.globalRole)
      .toBe("USER");
    await expect
      .poll(async () => getLatestAdminAction(targetId))
      .toBe("USER_ADMIN_REMOVED");
  });

  test("cannot remove admin rights from ADMIN_EMAILS bootstrap user", async ({ page }) => {
    const bootstrapEmail = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .find(Boolean);

    test.skip(!bootstrapEmail, "ADMIN_EMAILS is not configured in this environment.");

    await createUser({
      email: bootstrapEmail!,
      name: "Bootstrap Admin",
      status: "ACTIVE",
      globalRole: "ADMIN",
    });

    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users?filter=admins");
    const row = page.locator("tr", { hasText: bootstrapEmail! });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Remove admin" })).toBeDisabled();
  });

  test("cannot block or reject self", async ({ page }) => {
    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users");
    const row = page.locator("tr", { hasText: "admin@admin-users-test.negotaitions" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Block" })).toBeDisabled();
    await expect(row.getByRole("button", { name: "Reject" })).toBeDisabled();
    await expect(row.getByRole("button", { name: "Remove admin" })).toBeDisabled();
  });

  test("passwordHash is not rendered on /admin/users", async ({ page }) => {
    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users");
    const html = await page.content();
    expect(html).not.toContain("passwordHash");
  });

  test("sessionTokenHash is not rendered on /admin/users", async ({ page }) => {
    await page.setExtraHTTPHeaders({ Cookie: adminCookie });
    await page.goto("/admin/users");
    const html = await page.content();
    expect(html).not.toContain("sessionTokenHash");
  });
});
