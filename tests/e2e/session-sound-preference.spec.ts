import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createUserSessionCookie,
  query,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

async function loadSoundPreference(userId: string) {
  const rows = await query<{ sessionSoundEnabled: boolean }>(
    `SELECT "sessionSoundEnabled"
     FROM "User"
     WHERE "id" = $1`,
    [userId],
  );
  return rows[0]?.sessionSoundEnabled ?? null;
}

test("session sound preference API requires authentication", async ({ request }) => {
  const response = await request.get("/api/account/session-sound-preference");
  expect(response.status()).toBe(401);
});

test("authenticated user reads default session sound preference", async ({ request }) => {
  const user = await createActiveUser();
  const cookie = await createUserSessionCookie(user.id);

  const response = await request.get("/api/account/session-sound-preference", {
    headers: { Cookie: cookie },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { sessionSoundEnabled: boolean };
  expect(payload.sessionSoundEnabled).toBe(true);
});

test("strict boolean payload validation and self-only updates", async ({ request }) => {
  const user = await createActiveUser();
  const anotherUser = await createActiveUser();
  const cookie = await createUserSessionCookie(user.id);

  const invalidType = await request.patch("/api/account/session-sound-preference", {
    headers: { Cookie: cookie },
    data: { sessionSoundEnabled: "false" },
  });
  expect(invalidType.status()).toBe(400);

  const crossUserAttempt = await request.patch(
    "/api/account/session-sound-preference",
    {
      headers: { Cookie: cookie },
      data: { sessionSoundEnabled: false, userId: anotherUser.id },
    },
  );
  expect(crossUserAttempt.status()).toBe(400);
  expect(await loadSoundPreference(anotherUser.id)).toBe(true);

  const updateOff = await request.patch("/api/account/session-sound-preference", {
    headers: { Cookie: cookie },
    data: { sessionSoundEnabled: false },
  });
  expect(updateOff.ok()).toBeTruthy();
  expect(await loadSoundPreference(user.id)).toBe(false);

  const updateOn = await request.patch("/api/account/session-sound-preference", {
    headers: { Cookie: cookie },
    data: { sessionSoundEnabled: true },
  });
  expect(updateOn.ok()).toBeTruthy();
  expect(await loadSoundPreference(user.id)).toBe(true);
});
