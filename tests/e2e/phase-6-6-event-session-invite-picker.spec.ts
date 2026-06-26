import { createHash, randomBytes } from "crypto";

import { expect, test } from "@playwright/test";

import { cleanupE2eData, query } from "./helpers/db";

test.beforeAll(cleanupE2eData);
test.afterAll(cleanupE2eData);

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function createActiveUser(namePfx: string): Promise<{ id: string; email: string }> {
  const id = uid(namePfx);
  const email = `${id}@test.negotaitions.local`;
  await query(
    `INSERT INTO "User"
       ("id","email","passwordHash","name","role","globalRole","status","updatedAt")
     VALUES ($1,$2,'hash','Test User','PARTICIPANT','USER','ACTIVE',NOW())
     ON CONFLICT ("email") DO UPDATE SET "status"='ACTIVE',"updatedAt"=NOW()`,
    [id, email],
  );
  const rows = await query<{ id: string }>(`SELECT "id" FROM "User" WHERE "email"=$1`, [email]);
  return { id: rows[0]!.id, email };
}

async function createPendingUser(namePfx: string): Promise<{ id: string; email: string }> {
  const id = uid(namePfx);
  const email = `${id}@test.negotaitions.local`;
  await query(
    `INSERT INTO "User"
       ("id","email","passwordHash","name","role","globalRole","status","updatedAt")
     VALUES ($1,$2,'hash','Pending User','PARTICIPANT','USER','PENDING_APPROVAL',NOW())
     ON CONFLICT ("email") DO UPDATE SET "status"='PENDING_APPROVAL',"updatedAt"=NOW()`,
    [id, email],
  );
  const rows = await query<{ id: string }>(`SELECT "id" FROM "User" WHERE "email"=$1`, [email]);
  return { id: rows[0]!.id, email };
}

async function createUserSession(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO "UserSession"
       ("id","userId","sessionTokenHash","expiresAt","createdAt")
     VALUES (gen_random_uuid(),$1,$2,$3::timestamptz,NOW())`,
    [userId, tokenHash, expiresAt],
  );
  return rawToken;
}

const BROWSER_BASE_URL = process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "";

test.describe("Phase 6.6 — Event/session creation invite picker UX", () => {
  test.skip(!BROWSER_BASE_URL, "BASE_URL not set — requires a running dev server");

  test("event creation has facilitator selector and no legacy facilitator-name field", async ({ page }) => {
    const user = await createActiveUser("phase66_event_ui");
    const token = await createUserSession(user.id);

    await page.context().addCookies([
      {
        name: "auth_session",
        value: token,
        domain: new URL(BROWSER_BASE_URL).hostname,
        path: "/",
      },
    ]);

    await page.goto(`${BROWSER_BASE_URL}/events/new`, { waitUntil: "networkidle" });

    await expect(
      page.getByText(/Facilitator \/ Organizer|Фасилитатор \/ организатор/).first(),
    ).toBeVisible();
    await expect(page.locator("input[name='hostDisplayName']")).toHaveCount(0);
    await expect(
      page.getByPlaceholder(/Search by name or email|Поиск по имени или email/),
    ).toBeVisible();
  });

  test("session creation uses people picker and not checkbox invite list", async ({ page }) => {
    const user = await createActiveUser("phase66_session_ui");
    const token = await createUserSession(user.id);

    await page.context().addCookies([
      {
        name: "auth_session",
        value: token,
        domain: new URL(BROWSER_BASE_URL).hostname,
        path: "/",
      },
    ]);

    await page.goto(`${BROWSER_BASE_URL}/sessions/new`, { waitUntil: "networkidle" });

    await expect(
      page.getByPlaceholder(/Search by name or email|Поиск по имени или email/),
    ).toBeVisible();
    await expect(page.locator("input[type='checkbox']")).toHaveCount(0);
  });

  test("users search API requires active authenticated account", async ({ request }) => {
    const unauth = await request.get(`${BROWSER_BASE_URL}/api/users/search?q=test`);
    expect(unauth.status()).toBe(401);

    const pending = await createPendingUser("phase66_pending_search");
    const pendingToken = await createUserSession(pending.id);
    const forbidden = await request.get(`${BROWSER_BASE_URL}/api/users/search?q=test`, {
      headers: { Cookie: `auth_session=${pendingToken}` },
    });
    expect(forbidden.status()).toBe(403);
  });

  test("users search API returns only safe user fields", async ({ request }) => {
    const requester = await createActiveUser("phase66_requester");
    const target = await createActiveUser("phase66_target");
    const requesterToken = await createUserSession(requester.id);

    const response = await request.get(
      `${BROWSER_BASE_URL}/api/users/search?q=${encodeURIComponent(target.email.slice(0, 6))}`,
      {
        headers: { Cookie: `auth_session=${requesterToken}` },
      },
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.users)).toBeTruthy();
    expect(body.users.length).toBeGreaterThan(0);
    const first = body.users[0] as Record<string, unknown>;
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("email");
    expect(first).not.toHaveProperty("passwordHash");
    expect(first).not.toHaveProperty("sessionTokenHash");
    expect(first).not.toHaveProperty("hostToken");
    expect(first).not.toHaveProperty("participantToken");
    expect(first).not.toHaveProperty("joinToken");
  });
});
