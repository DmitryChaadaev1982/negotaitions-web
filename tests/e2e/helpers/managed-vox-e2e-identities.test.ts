import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  getManagedVoxE2ESlotDescriptor,
  isForbiddenManagedVoxFixtureProviderUsername,
  listManagedVoxE2EEmails,
  listManagedVoxE2EUserIds,
  MANAGED_VOX_E2E_SLOT_DESCRIPTORS,
  MANAGED_VOX_E2E_SLOTS,
  MANAGED_VOX_FIXTURE_PROVIDER_USERNAME_PREFIX,
} from "./managed-vox-e2e-identities";
import {
  MANAGED_PLAYWRIGHT_DEFAULT_VIDEO_PROVIDER,
  PLAYWRIGHT_VIDEO_PROVIDER_OVERRIDE_ENV,
  resolveManagedPlaywrightVideoProvider,
} from "./playwright-video-provider";

const REPO_ROOT = process.cwd();

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function loadProductionUsernameBuilder(): (userId: string) => string {
  const source = readRepoFile("lib/voximplant/username.ts");
  const match = source.match(
    /export function buildVoximplantUsernameForUser\(userId: string\): string \{\r?\n  const digest = createHash\("sha256"\)\.update\(userId\)\.digest\("hex"\)\.slice\(0, 16\);\r?\n  return `ng_u_\$\{digest\}`;\r?\n\}/,
  );
  assert.ok(
    match,
    "production buildVoximplantUsernameForUser source contract is missing or changed",
  );
  const javascript = match[0]
    .replace("export ", "")
    .replace("(userId: string): string", "(userId)");
  return new Function(
    "createHash",
    `${javascript}\nreturn buildVoximplantUsernameForUser;`,
  )(createHash) as (userId: string) => string;
}

test("TI-03/TI-04/TI-12 managed slots reuse the production username builder", () => {
  const buildUsername = loadProductionUsernameBuilder();
  const helperSource = readRepoFile("tests/e2e/helpers/managed-vox-e2e-identities.ts");
  const dbSource = readRepoFile("tests/e2e/helpers/db.ts");

  assert.doesNotMatch(helperSource, /createHash\("sha256"\)/);
  assert.doesNotMatch(helperSource, /function buildVoximplantUsernameForUser/);
  assert.doesNotMatch(dbSource, /function buildVoximplantUsernameForUser/);
  assert.match(
    readRepoFile("lib/voximplant/identity.ts"),
    /export \{ buildVoximplantUsernameForUser \}/,
  );
  assert.match(
    readRepoFile("lib/voximplant/username.ts"),
    /export function buildVoximplantUsernameForUser/,
  );

  const usernames = MANAGED_VOX_E2E_SLOTS.map((slot) =>
    buildUsername(getManagedVoxE2ESlotDescriptor(slot).userId),
  );
  for (const username of usernames) {
    assert.match(username, /^ng_u_[0-9a-f]{16}$/);
  }
  assert.equal(new Set(usernames).size, 4);

  const firstId = getManagedVoxE2ESlotDescriptor("FACILITATOR_01").userId;
  assert.equal(buildUsername(firstId), buildUsername(firstId));
});

test("TI-14 Management API mock seam is not added for test convenience", () => {
  const management = readRepoFile("lib/voximplant/management-api.ts");
  const core = readRepoFile("lib/voximplant/management-api-core.ts");
  assert.match(management, /export \{\s*[\s\S]*ensureRemoteVoximplantUser/);
  assert.match(core, /export async function ensureRemoteVoximplantUser/);
  assert.doesNotMatch(management, /__testHook|injectManagementApi|setManagementApiForTests/);
  assert.doesNotMatch(core, /__testHook|injectManagementApi|setManagementApiForTests/);
});

test("TI-13 production identity and Management API source stay on the existing contract", () => {
  const identity = readRepoFile("lib/voximplant/identity.ts");
  const management = readRepoFile("lib/voximplant/management-api.ts");
  const core = readRepoFile("lib/voximplant/management-api-core.ts");

  assert.match(identity, /export \{ buildVoximplantUsernameForUser \}/);
  assert.match(identity, /ensureRemoteVoximplantUser/);
  assert.match(identity, /getOrCreateVoximplantIdentityForUser/);
  assert.match(management, /import "server-only"/);
  assert.match(management, /ensureRemoteVoximplantUser/);
  assert.match(core, /export async function ensureRemoteVoximplantUser/);
  assert.match(core, /outcome: "already_exists"/);
  assert.match(core, /callManagementApi\("AddUser"/);
  assert.doesNotMatch(identity, /e2e_managed_vox_/);
  assert.doesNotMatch(management, /e2e_managed_vox_/);
  assert.doesNotMatch(core, /e2e_managed_vox_/);
});

test("four managed slots have distinct fixed ids and reserved emails", () => {
  const ids = listManagedVoxE2EUserIds();
  const emails = listManagedVoxE2EEmails();
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  assert.equal(new Set(emails).size, 4);
  for (const email of emails) {
    assert.doesNotMatch(email, /@test\.invalid$/);
    assert.doesNotMatch(email, /\.negotaitions(\.local)?$/);
    assert.doesNotMatch(email, /@example\.com$/);
  }
  assert.equal(
    MANAGED_VOX_E2E_SLOT_DESCRIPTORS.FACILITATOR_01.userId,
    "e2e_managed_vox_facilitator_01",
  );
});

test("TI-09 ordinary managed Playwright ignores operator VIDEO_PROVIDER=voximplant", () => {
  assert.equal(
    resolveManagedPlaywrightVideoProvider({
      VIDEO_PROVIDER: "voximplant",
    }),
    MANAGED_PLAYWRIGHT_DEFAULT_VIDEO_PROVIDER,
  );
  assert.equal(MANAGED_PLAYWRIGHT_DEFAULT_VIDEO_PROVIDER, "livekit");
});

test("TI-10 explicit PLAYWRIGHT_VIDEO_PROVIDER can still select voximplant", () => {
  assert.equal(
    resolveManagedPlaywrightVideoProvider({
      VIDEO_PROVIDER: "livekit",
      [PLAYWRIGHT_VIDEO_PROVIDER_OVERRIDE_ENV]: "voximplant",
    }),
    "voximplant",
  );
});

test("R1-01/R1-02 managed room-parity Vox access does not mutate the shared serial fixture userId", () => {
  const roomParity = readRepoFile("tests/e2e/voximplant-room-parity.spec.ts");
  assert.match(roomParity, /createIsolatedManagedParticipantVoxAccess/);
  assert.match(roomParity, /deleteIsolatedManagedParticipantVoxAccess/);
  assert.match(roomParity, /participant1UserId/);
  assert.match(
    roomParity,
    /ensureManagedVoxE2EUser\("PARTICIPANT_01"\)/,
  );
  assert.doesNotMatch(
    roomParity,
    /UPDATE\s+"SessionParticipant"\s+SET\s+"userId"/,
  );
  assert.match(
    roomParity,
    /role reassignment is visible on subsequent sidebar fetch without reload/,
  );
  assert.match(
    roomParity,
    /expect\(sharedBinding\[0\]\?\.userId\)\.toBe\(fixture\.participant1UserId\)/,
  );
});

test("R1-03/R1-05 cleanup and DB fixtures cannot plant ACTIVE ng_u_fixture_* on canonical slots", () => {
  const dbHelper = readRepoFile("tests/e2e/helpers/db.ts");
  const dbTests = readRepoFile(
    "tests/e2e/helpers/managed-vox-e2e-identities.db.test.ts",
  );
  const cleanupStart = dbHelper.indexOf("export async function cleanupE2eData");
  const managedCleanupStart = dbHelper.indexOf(
    "export async function cleanupManagedVoxE2EDomainState",
  );
  assert.ok(cleanupStart >= 0);
  assert.ok(managedCleanupStart >= 0);
  const cleanupSlice = dbHelper.slice(cleanupStart, managedCleanupStart + 800);
  assert.doesNotMatch(cleanupSlice, /DELETE FROM "VideoProviderIdentity"/);
  assert.doesNotMatch(dbTests, /INSERT INTO "VideoProviderIdentity"/);
  assert.doesNotMatch(dbTests, /`ng_u_fixture_\$\{/);
  assert.equal(
    isForbiddenManagedVoxFixtureProviderUsername(
      `${MANAGED_VOX_FIXTURE_PROVIDER_USERNAME_PREFIX}e2e_managed_vox_participant_01`,
    ),
    true,
  );
  assert.equal(
    isForbiddenManagedVoxFixtureProviderUsername("ng_u_147f7343afa8773d"),
    false,
  );
});

test("event-lobby managed PARTICIPANT_02 path creates its own event and does not rewrite shared memberships", () => {
  const eventLobby = readRepoFile("tests/e2e/voximplant-event-lobby.spec.ts");
  const start = eventLobby.indexOf(
    'test("voximplant provider path is present and livekit path is isolated"',
  );
  const end = eventLobby.indexOf(
    'test("session creation from event preserves role assignment and account room path"',
  );
  assert.ok(start >= 0 && end > start);
  const managedTest = eventLobby.slice(start, end);
  assert.match(managedTest, /ensureManagedVoxE2EUser\("PARTICIPANT_02"\)/);
  assert.match(managedTest, /createE2eEvent/);
  assert.match(managedTest, /INSERT INTO "EventInvite"/);
  assert.doesNotMatch(managedTest, /UPDATE "EventParticipant"/);
  assert.doesNotMatch(managedTest, /UPDATE "SessionParticipant"/);
});

test("TI-11 smoke/browser-smoke managed local config pins VIDEO_PROVIDER away from inherited voximplant", () => {
  const localConfig = readRepoFile("playwright.local.config.ts");
  const defaultConfig = readRepoFile("playwright.config.ts");
  const packageJson = readRepoFile("package.json");
  const modeLib = readRepoFile("scripts/agent-tooling/run-playwright-mode-lib.mjs");

  assert.match(localConfig, /resolveManagedPlaywrightVideoProvider/);
  assert.match(localConfig, /VIDEO_PROVIDER: resolveManagedPlaywrightVideoProvider\(\)/);
  assert.match(defaultConfig, /VIDEO_PROVIDER: "livekit"/);
  assert.match(packageJson, /"test:e2e:smoke": .*run-playwright-mode\.mjs --mode=managed/);
  assert.match(
    packageJson,
    /"test:e2e:smoke:browser": .*run-playwright-mode\.mjs --mode=managed/,
  );
  assert.match(modeLib, /LOCAL_CONFIG = "playwright.local.config.ts"/);
});
