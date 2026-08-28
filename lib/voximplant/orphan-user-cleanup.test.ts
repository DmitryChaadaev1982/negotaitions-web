import assert from "node:assert/strict";
import test from "node:test";

import { listManagedVoxE2EUserIds } from "@/tests/e2e/helpers/managed-vox-e2e-identities";
import { buildVoximplantUsernameForUser } from "@/lib/voximplant/username";
import {
  applyCandidateDeletes,
  assertManagedKeepComplete,
  buildKeepIndex,
  classifyRemoteUsers,
  collectExplicitPocUsernames,
  DOCUMENTED_VOX_POC_USERNAMES,
  fingerprintCandidates,
  MANAGED_VOX_E2E_KEEP_USER_IDS,
  parseOrphanCleanupCli,
  resolveManagedVoxE2EKeepUserIds,
  runOrphanUserCleanup,
  type AppUserRow,
  type DeleteCandidate,
  type OrphanCleanupLoaders,
  type RemoteVoxUser,
} from "@/lib/voximplant/orphan-user-cleanup";

function user(id: string, email = `${id}@example.test`): AppUserRow {
  return { id, email, name: id };
}

function remote(
  userName: string,
  userId = "1000",
  displayName: string | null = userName,
): RemoteVoxUser {
  return {
    userId,
    userName,
    userDisplayName: displayName,
    applicationId: "1",
    applicationName: "negotaitions-video-poc",
    createdAt: null,
    modifiedAt: null,
  };
}

function loaders(params: {
  production?: AppUserRow[] | "fail";
  local?: AppUserRow[] | "fail";
  e2e?: AppUserRow[];
  remote?: RemoteVoxUser[];
  explicit?: string[];
}): OrphanCleanupLoaders {
  return {
    loadProductionUsers: async () =>
      params.production === "fail"
        ? {
            ok: false,
            code: "PRODUCTION_KEEP_UNAVAILABLE",
            message: "production unavailable",
          }
        : {
            ok: true,
            users: params.production ?? [],
            source: "test-production",
          },
    loadLocalManualUsers: async () =>
      params.local === "fail"
        ? {
            ok: false,
            code: "LOCAL_MANUAL_KEEP_UNAVAILABLE",
            message: "local manual unavailable",
          }
        : {
            ok: true,
            users: params.local ?? [],
            source: "localhost:5432",
          },
    loadE2eUsers: async () => ({
      ok: true,
      users: params.e2e ?? [],
      source: "localhost:5433",
    }),
    loadRemoteUsers: async () => ({
      ok: true,
      users: params.remote ?? [],
      applicationName: "negotaitions-video-poc",
    }),
    loadExplicitUsernames: () => params.explicit ?? [...DOCUMENTED_VOX_POC_USERNAMES],
  };
}

const PRODUCTION_USER = user("prod_user_keep");
const LOCAL_USER = user("local_manual_keep");
const PRODUCTION_USERNAME = buildVoximplantUsernameForUser(PRODUCTION_USER.id);
const LOCAL_USERNAME = buildVoximplantUsernameForUser(LOCAL_USER.id);
const MANAGED_USERNAMES = MANAGED_VOX_E2E_KEEP_USER_IDS.map((id) =>
  buildVoximplantUsernameForUser(id),
);
const ORPHAN_USERNAME = "ng_u_ffffffffffffffff";

test("managed keep IDs stay locked to the four canonical E2E slots", () => {
  assert.deepEqual(resolveManagedVoxE2EKeepUserIds(), listManagedVoxE2EUserIds());
  assert.deepEqual([...MANAGED_VOX_E2E_KEEP_USER_IDS], listManagedVoxE2EUserIds());
});

test("VC-01 production user is KEEP", async () => {
  const result = await runOrphanUserCleanup({
    mode: "dry-run",
    loaders: loaders({
      production: [PRODUCTION_USER],
      local: [LOCAL_USER],
      remote: [remote(PRODUCTION_USERNAME, "17300001")],
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.classified[0]?.classification, "KEEP_PRODUCTION");
  assert.equal(result.report.summary.keepProduction, 1);
  assert.equal(result.report.summary.deleteCandidates, 0);
});

test("VC-02 manual-local user is KEEP", async () => {
  const result = await runOrphanUserCleanup({
    mode: "dry-run",
    loaders: loaders({
      production: [PRODUCTION_USER],
      local: [LOCAL_USER],
      remote: [remote(LOCAL_USERNAME, "17300002")],
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.classified[0]?.classification, "KEEP_LOCAL_MANUAL");
  assert.equal(result.report.summary.keepLocalManual, 1);
});

test("VC-03 all four managed E2E users are KEEP", async () => {
  const result = await runOrphanUserCleanup({
    mode: "dry-run",
    loaders: loaders({
      production: [PRODUCTION_USER],
      local: [LOCAL_USER],
      remote: MANAGED_USERNAMES.map((username, index) =>
        remote(username, String(17200000 + index)),
      ),
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.summary.keepManagedE2e, 4);
  assert.deepEqual(
    result.report.classified.map((row) => row.classification),
    [
      "KEEP_MANAGED_E2E",
      "KEEP_MANAGED_E2E",
      "KEEP_MANAGED_E2E",
      "KEEP_MANAGED_E2E",
    ],
  );
  assert.deepEqual(result.managedKeepUsernames, [...MANAGED_USERNAMES].sort());
});

test("VC-04 remote ng_u_* absent from all keep sources is DELETE_CANDIDATE", async () => {
  const result = await runOrphanUserCleanup({
    mode: "dry-run",
    loaders: loaders({
      production: [PRODUCTION_USER],
      local: [LOCAL_USER],
      e2e: [user("e2e_ephemeral_orphan")],
      remote: [remote(ORPHAN_USERNAME, "17309999", "orphan")],
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.candidates.length, 1);
  assert.equal(result.report.candidates[0]?.reason, "NO_CURRENT_APPLICATION_IDENTITY");
  assert.equal(result.report.classified[0]?.classification, "DELETE_CANDIDATE");
});

test("VC-05 non-ng_u_* user is OUT_OF_SCOPE", async () => {
  const result = await runOrphanUserCleanup({
    mode: "dry-run",
    loaders: loaders({
      production: [PRODUCTION_USER],
      local: [LOCAL_USER],
      remote: [remote("facilitator", "10")],
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.classified[0]?.classification, "OUT_OF_SCOPE");
  assert.equal(result.report.summary.deleteCandidates, 0);
  assert.equal(result.report.summary.outOfScope, 1);
});

test("VC-06 shared production and local identity stays KEEP without duplicate candidates", async () => {
  const shared = user("shared_live_user");
  const username = buildVoximplantUsernameForUser(shared.id);
  const result = await runOrphanUserCleanup({
    mode: "dry-run",
    loaders: loaders({
      production: [shared],
      local: [shared],
      remote: [remote(username, "17300006")],
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.classified.length, 1);
  assert.equal(result.report.classified[0]?.classification, "KEEP_PRODUCTION");
  assert.deepEqual(result.report.classified[0]?.keepSources, [
    "PRODUCTION",
    "LOCAL_MANUAL",
  ]);
  assert.equal(result.report.summary.keepProduction, 1);
  assert.equal(result.report.summary.keepLocalManual, 1);
  assert.equal(result.report.summary.overlap, 1);
  assert.equal(result.report.summary.deleteCandidates, 0);
});

test("VC-07 hash collision / ambiguous mapping becomes AMBIGUOUS_BLOCKED", () => {
  const keepIndex = buildKeepIndex({
    productionUsers: [user("prod-collision-a")],
    localManualUsers: [user("local-collision-b")],
    explicitUsernames: [],
    buildUsername: (userId) =>
      userId === "prod-collision-a" || userId === "local-collision-b"
        ? "ng_u_aaaaaaaaaaaaaaaa"
        : buildVoximplantUsernameForUser(userId),
  });
  assert.equal(keepIndex.collisions.length, 1);
  assert.deepEqual(keepIndex.collisions[0]?.userIds.sort(), [
    "local-collision-b",
    "prod-collision-a",
  ]);

  const report = classifyRemoteUsers({
    remoteUsers: [remote("ng_u_aaaaaaaaaaaaaaaa", "17300007")],
    keepIndex,
  });
  assert.equal(report.classified[0]?.classification, "AMBIGUOUS_BLOCKED");
  assert.equal(report.summary.deleteCandidates, 0);
  assert.equal(report.summary.ambiguousBlocked, 1);
});

test("VC-08 production DB unavailable fails closed", async () => {
  const result = await runOrphanUserCleanup({
    mode: "dry-run",
    loaders: loaders({
      production: "fail",
      local: [LOCAL_USER],
      remote: [remote(ORPHAN_USERNAME)],
    }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "PRODUCTION_KEEP_UNAVAILABLE");
  assert.equal(result.delUserCalls, 0);
});

test("VC-09 manual local DB unavailable fails closed", async () => {
  const result = await runOrphanUserCleanup({
    mode: "dry-run",
    loaders: loaders({
      production: [PRODUCTION_USER],
      local: "fail",
      remote: [remote(ORPHAN_USERNAME)],
    }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "LOCAL_MANUAL_KEEP_UNAVAILABLE");
  assert.equal(result.delUserCalls, 0);
});

test("VC-10 missing expected managed identities fails closed", () => {
  const keepIndex = buildKeepIndex({
    productionUsers: [PRODUCTION_USER],
    localManualUsers: [LOCAL_USER],
    managedUserIds: MANAGED_VOX_E2E_KEEP_USER_IDS.slice(0, 3),
    explicitUsernames: [],
  });
  const refusal = assertManagedKeepComplete(keepIndex);
  assert.ok(refusal);
  assert.equal(refusal?.code, "MANAGED_E2E_KEEP_INCOMPLETE");
});

test("VC-11 dry-run performs zero DelUser calls", async () => {
  let deleteCalls = 0;
  const result = await runOrphanUserCleanup({
    mode: "dry-run",
    loaders: loaders({
      production: [PRODUCTION_USER],
      local: [LOCAL_USER],
      remote: [remote(ORPHAN_USERNAME, "17300011")],
    }),
    deleteUser: async () => {
      deleteCalls += 1;
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.delUserCalls, 0);
  assert.equal(deleteCalls, 0);
  assert.equal(result.report.summary.deleteCandidates, 1);
});

test("VC-12 --apply without expected-count refuses", () => {
  const parsed = parseOrphanCleanupCli(["--apply"]);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.code, "APPLY_REQUIRED_EXPECTED_COUNT");
});

test("VC-13 expected-count mismatch refuses", async () => {
  const result = await runOrphanUserCleanup({
    mode: "apply",
    expectedCount: 2,
    loaders: loaders({
      production: [PRODUCTION_USER],
      local: [LOCAL_USER],
      remote: [remote(ORPHAN_USERNAME, "17300013")],
    }),
    deleteUser: async () => {
      throw new Error("should not delete");
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "EXPECTED_COUNT_MISMATCH");
  assert.equal(result.delUserCalls, 0);
});

test("VC-14 candidate-set drift between dry-run and apply refuses", async () => {
  const result = await runOrphanUserCleanup({
    mode: "apply",
    expectedCount: 1,
    expectedUsernames: ["ng_u_0000000000000000"],
    loaders: loaders({
      production: [PRODUCTION_USER],
      local: [LOCAL_USER],
      remote: [remote(ORPHAN_USERNAME, "17300014")],
    }),
    deleteUser: async () => {
      throw new Error("should not delete");
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "CANDIDATE_SET_DRIFT");
  assert.equal(result.delUserCalls, 0);
});

test("VC-15 user_id=all / wildcard mode does not exist", () => {
  for (const argv of [
    ["--all"],
    ["user_id=all"],
    ["--user-id", "all"],
    ["--user-name", "all"],
    ["--prefix", "ng_u_"],
  ]) {
    const parsed = parseOrphanCleanupCli(argv);
    assert.equal(parsed.ok, false, argv.join(" "));
    if (!parsed.ok) {
      assert.equal(parsed.code, "WILDCARD_MODE_FORBIDDEN");
    }
  }
  const dryRun = parseOrphanCleanupCli([]);
  assert.equal(dryRun.ok, true);
  if (dryRun.ok) {
    assert.equal(dryRun.mode, "dry-run");
  }
});

test("VC-16 batch failure stops subsequent deletes", async () => {
  const candidates: DeleteCandidate[] = Array.from({ length: 15 }, (_, index) => ({
    userId: String(2000 + index),
    userName: `ng_u_${index.toString(16).padStart(16, "0")}`,
    displayName: null,
    reason: "NO_CURRENT_APPLICATION_IDENTITY",
    sourceHint: null,
  }));
  const deleted: string[] = [];
  const applied = await applyCandidateDeletes({
    candidates,
    batchSize: 5,
    deleteUser: async (candidate) => {
      if (candidate.userName.endsWith("0000000000000005")) {
        throw new Error("provider batch failed");
      }
      deleted.push(candidate.userName);
    },
  });
  assert.equal(applied.ok, false);
  assert.equal(applied.code, "BATCH_DELETE_FAILED");
  assert.equal(applied.failedBatchIndex, 1);
  assert.equal(deleted.length, 5);
  assert.equal(applied.deletedUsernames.length, 5);
  assert.equal(
    deleted.some((name) => name.endsWith("000000000000000a")),
    false,
  );
});

test("bare CLI invocation defaults to dry-run and apply still requires expected-count", () => {
  const bare = parseOrphanCleanupCli(["--dry-run"]);
  assert.equal(bare.ok, true);
  if (bare.ok) assert.equal(bare.mode, "dry-run");
  const apply = parseOrphanCleanupCli(["--apply", "--expected-count", "4"]);
  assert.equal(apply.ok, true);
  if (apply.ok) {
    assert.equal(apply.mode, "apply");
    assert.equal(apply.expectedCount, 4);
  }
});

test("explicit POC usernames are collected without reading passwords", () => {
  const usernames = collectExplicitPocUsernames({
    VOXIMPLANT_PARTICIPANT_A_USER: "participant-a",
    VOXIMPLANT_PARTICIPANT_B_USER: "participant-b",
    VOXIMPLANT_FACILITATOR_USER: "facilitator",
    VOXIMPLANT_PARTICIPANT_A_PASSWORD: "secret-must-not-appear",
  });
  assert.deepEqual(usernames.sort(), [
    "facilitator",
    "participant-a",
    "participant-b",
  ]);
  assert.equal(usernames.join(" ").includes("secret"), false);
});

test("candidate fingerprint is stable for the same set", () => {
  const candidates: DeleteCandidate[] = [
    {
      userId: "2",
      userName: ORPHAN_USERNAME,
      displayName: null,
      reason: "NO_CURRENT_APPLICATION_IDENTITY",
      sourceHint: null,
    },
    {
      userId: "1",
      userName: "ng_u_0000000000000001",
      displayName: null,
      reason: "NO_CURRENT_APPLICATION_IDENTITY",
      sourceHint: null,
    },
  ];
  assert.equal(fingerprintCandidates(candidates), fingerprintCandidates([...candidates].reverse()));
});

test("ephemeral E2E correlation is a source hint only", async () => {
  const ephemeralId = "e2e_old_ephemeral_user";
  const ephemeralUsername = buildVoximplantUsernameForUser(ephemeralId);
  const result = await runOrphanUserCleanup({
    mode: "dry-run",
    loaders: loaders({
      production: [PRODUCTION_USER],
      local: [LOCAL_USER],
      e2e: [user(ephemeralId)],
      remote: [remote(ephemeralUsername, "17300099")],
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.candidates[0]?.reason, "NO_CURRENT_APPLICATION_IDENTITY");
  assert.equal(result.report.candidates[0]?.sourceHint, "CURRENT_EPHEMERAL_E2E_USER");
  assert.equal(result.report.classified[0]?.classification, "DELETE_CANDIDATE");
});
