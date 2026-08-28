import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  createE2eEvent,
  e2eId,
  e2eName,
  ensureManagedVoxE2EUser,
  isE2eDatabaseConfigured,
  listManagedVoxE2EUserIds,
  query,
} from "./db";
import {
  getManagedVoxE2ESlotDescriptor,
  isForbiddenManagedVoxFixtureProviderUsername,
} from "./managed-vox-e2e-identities";

const canMutateDb = isE2eDatabaseConfigured();

function loadProductionUsernameBuilder(): (userId: string) => string {
  const source = readFileSync(
    path.join(process.cwd(), "lib/voximplant/username.ts"),
    "utf8",
  );
  const match = source.match(
    /export function buildVoximplantUsernameForUser\(userId: string\): string \{\r?\n  const digest = createHash\("sha256"\)\.update\(userId\)\.digest\("hex"\)\.slice\(0, 16\);\r?\n  return `ng_u_\$\{digest\}`;\r?\n\}/,
  );
  if (!match) {
    throw new Error("production username builder source contract missing");
  }
  const javascript = match[0]
    .replace("export ", "")
    .replace("(userId: string): string", "(userId)");
  return new Function(
    "createHash",
    `${javascript}\nreturn buildVoximplantUsernameForUser;`,
  )(createHash) as (userId: string) => string;
}

async function countUsersById(userId: string) {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "User" WHERE "id" = $1`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

test("TI-01 same managed slot returns the same explicit User.id", async (t) => {
  if (!canMutateDb) {
    t.skip("E2E_DATABASE_URL is not configured");
    return;
  }

  const first = await ensureManagedVoxE2EUser("FACILITATOR_01");
  const second = await ensureManagedVoxE2EUser("FACILITATOR_01");
  assert.equal(first.id, "e2e_managed_vox_facilitator_01");
  assert.equal(second.id, first.id);
});

test("TI-02 recreated managed slot keeps the exact same User.id", async (t) => {
  if (!canMutateDb) {
    t.skip("E2E_DATABASE_URL is not configured");
    return;
  }

  const created = await ensureManagedVoxE2EUser("OBSERVER_01");
  await query(`DELETE FROM "UserConsent" WHERE "userId" = $1`, [created.id]);
  await query(`DELETE FROM "User" WHERE "id" = $1`, [created.id]);
  assert.equal(await countUsersById(created.id), 0);

  const recreated = await ensureManagedVoxE2EUser("OBSERVER_01");
  assert.equal(recreated.id, created.id);
  assert.equal(recreated.id, getManagedVoxE2ESlotDescriptor("OBSERVER_01").userId);
});

test("TI-03/TI-04 same User.id derives a stable distinct ng_u_* username", async (t) => {
  if (!canMutateDb) {
    t.skip("E2E_DATABASE_URL is not configured");
    return;
  }

  const buildUsername = loadProductionUsernameBuilder();
  const users = [];
  for (const slot of [
    "FACILITATOR_01",
    "PARTICIPANT_01",
    "PARTICIPANT_02",
    "OBSERVER_01",
  ] as const) {
    users.push(await ensureManagedVoxE2EUser(slot));
  }
  const usernames = users.map((user) => buildUsername(user.id));
  assert.equal(new Set(users.map((user) => user.id)).size, 4);
  assert.equal(new Set(usernames).size, 4);
  assert.equal(buildUsername(users[0]!.id), usernames[0]);
});

test("TI-05/TI-06/R1-04 ordinary cleanup preserves managed Users without a provider identity", async (t) => {
  if (!canMutateDb) {
    t.skip("E2E_DATABASE_URL is not configured");
    return;
  }

  const managed = await ensureManagedVoxE2EUser("PARTICIPANT_01");
  const ephemeral = await createActiveUser();
  const identitiesBefore = await query<{ providerUsername: string }>(
    `SELECT "providerUsername" FROM "VideoProviderIdentity" WHERE "userId" = $1`,
    [managed.id],
  );
  for (const identity of identitiesBefore) {
    assert.equal(
      isForbiddenManagedVoxFixtureProviderUsername(identity.providerUsername),
      false,
    );
  }

  await cleanupE2eData();

  assert.equal(await countUsersById(managed.id), 1);
  assert.equal(await countUsersById(ephemeral.id), 0);
  const identitiesAfter = await query<{ providerUsername: string }>(
    `SELECT "providerUsername" FROM "VideoProviderIdentity" WHERE "userId" = $1`,
    [managed.id],
  );
  assert.equal(identitiesAfter.length, identitiesBefore.length);
  for (const identity of identitiesAfter) {
    assert.equal(
      isForbiddenManagedVoxFixtureProviderUsername(identity.providerUsername),
      false,
    );
  }
});

test("R1-03 canonical managed slots are not left with ng_u_fixture_* ACTIVE identities", async (t) => {
  if (!canMutateDb) {
    t.skip("E2E_DATABASE_URL is not configured");
    return;
  }

  const poisoned = await query<{
    userId: string;
    providerUsername: string;
    status: string;
  }>(
    `SELECT "userId", "providerUsername", "status"
     FROM "VideoProviderIdentity"
     WHERE "userId" = ANY($1::text[])
       AND "providerUsername" LIKE 'ng_u_fixture_%'
       AND lower("status") = 'active'`,
    [listManagedVoxE2EUserIds()],
  );
  assert.equal(poisoned.length, 0);
});

test("R1-05/R1-06 ordinary cleanup does not delete a legitimate PARTICIPANT_02 identity", async (t) => {
  if (!canMutateDb) {
    t.skip("E2E_DATABASE_URL is not configured");
    return;
  }

  const participant02 = getManagedVoxE2ESlotDescriptor("PARTICIPANT_02");
  await ensureManagedVoxE2EUser("PARTICIPANT_02");
  const before = await query<{
    id: string;
    providerUsername: string;
    status: string;
  }>(
    `SELECT "id", "providerUsername", "status"
     FROM "VideoProviderIdentity"
     WHERE "userId" = $1 AND "provider" = 'voximplant'`,
    [participant02.userId],
  );
  for (const identity of before) {
    assert.equal(
      isForbiddenManagedVoxFixtureProviderUsername(identity.providerUsername),
      false,
    );
  }

  await cleanupE2eData();

  const after = await query<{
    id: string;
    providerUsername: string;
    status: string;
  }>(
    `SELECT "id", "providerUsername", "status"
     FROM "VideoProviderIdentity"
     WHERE "userId" = $1 AND "provider" = 'voximplant'`,
    [participant02.userId],
  );
  assert.equal(after.length, before.length);
  if (before.length === 1) {
    assert.equal(after[0]?.id, before[0]?.id);
    assert.equal(after[0]?.providerUsername, before[0]?.providerUsername);
    assert.equal(after[0]?.status, before[0]?.status);
  }
});

test("TI-07 managed Session/Event memberships are removed by ordinary cleanup", async (t) => {
  if (!canMutateDb) {
    t.skip("E2E_DATABASE_URL is not configured");
    return;
  }

  const managed = await ensureManagedVoxE2EUser("FACILITATOR_01");
  const negotiationCase = await createE2eCase();
  const event = await createE2eEvent({ title: e2eName("Managed Vox Membership Event") });
  const sessionId = e2eId("managed-vox-session");

  await query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "preparationDurationSeconds", "durationSeconds", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'ctx', 'instructions', 'EN', 300, 900, NOW())`,
    [
      sessionId,
      negotiationCase.id,
      managed.id,
      e2eName("Managed Vox Membership Session"),
      negotiationCase.title,
    ],
  );
  await query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "userId", "type", "joinToken", "displayName", "updatedAt")
     VALUES ($1, $2, $3, 'FACILITATOR', $4, 'Managed Fac', NOW())`,
    [e2eId("managed-sp"), sessionId, managed.id, e2eId("managed-join")],
  );
  await query(
    `INSERT INTO "EventParticipant"
       ("id", "eventId", "userId", "displayName", "participantToken", "isHost",
        "joinedAt", "lastSeenAt", "updatedAt")
     VALUES ($1, $2, $3, 'Managed Host', $4, true, NOW(), NOW(), NOW())`,
    [e2eId("managed-ep"), event.id, managed.id, e2eId("managed-token")],
  );

  await cleanupE2eData();

  assert.equal(await countUsersById(managed.id), 1);
  const sessionMemberships = await query<{ id: string }>(
    `SELECT "id" FROM "SessionParticipant" WHERE "userId" = $1`,
    [managed.id],
  );
  const eventMemberships = await query<{ id: string }>(
    `SELECT "id" FROM "EventParticipant" WHERE "userId" = $1`,
    [managed.id],
  );
  const leftoverSessions = await query<{ id: string }>(
    `SELECT "id" FROM "Session" WHERE "id" = $1 OR "facilitatorId" = $2`,
    [sessionId, managed.id],
  );
  assert.equal(sessionMemberships.length, 0);
  assert.equal(eventMemberships.length, 0);
  assert.equal(leftoverSessions.length, 0);
});

test("TI-08 managed fixture normalization restores required mutable User fields", async (t) => {
  if (!canMutateDb) {
    t.skip("E2E_DATABASE_URL is not configured");
    return;
  }

  const managed = await ensureManagedVoxE2EUser("PARTICIPANT_02");
  await query(
    `UPDATE "User"
     SET "name" = 'Mutated',
         "status" = 'BLOCKED',
         "globalRole" = 'ADMIN',
         "preferredLocale" = 'en',
         "sessionSoundEnabled" = FALSE,
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [managed.id],
  );

  const restored = await ensureManagedVoxE2EUser("PARTICIPANT_02");
  assert.equal(restored.id, managed.id);
  assert.equal(restored.name, getManagedVoxE2ESlotDescriptor("PARTICIPANT_02").name);
  assert.equal(restored.status, "ACTIVE");
  assert.equal(restored.globalRole, "USER");
  assert.equal(restored.preferredLocale, "ru");
  assert.equal(restored.sessionSoundEnabled, true);
  assert.deepEqual(listManagedVoxE2EUserIds().sort(), [
    "e2e_managed_vox_facilitator_01",
    "e2e_managed_vox_observer_01",
    "e2e_managed_vox_participant_01",
    "e2e_managed_vox_participant_02",
  ]);
});
