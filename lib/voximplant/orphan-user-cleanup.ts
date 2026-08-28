import { createHash } from "node:crypto";

import {
  buildVoximplantUsernameForUser,
  isGeneratedVoximplantUsername,
} from "@/lib/voximplant/username";

export const VOX_ORPHAN_CLEANUP_BATCH_SIZE = 10;

export const DOCUMENTED_VOX_POC_USERNAMES = [
  "participant-a",
  "participant-b",
  "facilitator",
] as const;

export const MANAGED_VOX_E2E_KEEP_USER_IDS = [
  "e2e_managed_vox_facilitator_01",
  "e2e_managed_vox_participant_01",
  "e2e_managed_vox_participant_02",
  "e2e_managed_vox_observer_01",
] as const;

export type KeepSource =
  | "PRODUCTION"
  | "LOCAL_MANUAL"
  | "MANAGED_E2E"
  | "EXPLICIT";

export type ExclusiveClassification =
  | "KEEP_PRODUCTION"
  | "KEEP_LOCAL_MANUAL"
  | "KEEP_MANAGED_E2E"
  | "KEEP_EXPLICIT"
  | "DELETE_CANDIDATE"
  | "AMBIGUOUS_BLOCKED"
  | "OUT_OF_SCOPE";

export type OrphanCleanupErrorCode =
  | "PRODUCTION_KEEP_UNAVAILABLE"
  | "LOCAL_MANUAL_KEEP_UNAVAILABLE"
  | "MANAGED_E2E_KEEP_INCOMPLETE"
  | "APPLY_REQUIRED_EXPECTED_COUNT"
  | "EXPECTED_COUNT_MISMATCH"
  | "CANDIDATE_SET_DRIFT"
  | "WILDCARD_MODE_FORBIDDEN"
  | "APPLY_REQUIRES_EXPLICIT_FLAG"
  | "BATCH_DELETE_FAILED"
  | "REMOTE_INVENTORY_UNAVAILABLE";

export type AppUserRow = {
  id: string;
  email: string | null;
  name: string | null;
};

export type RemoteVoxUser = {
  userId: string;
  userName: string;
  userDisplayName: string | null;
  applicationId: string | null;
  applicationName: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
};

export type KeepMembership = {
  source: KeepSource;
  userId: string | null;
};

export type KeepUsernameRecord = {
  username: string;
  memberships: KeepMembership[];
  userIds: string[];
  ambiguous: boolean;
};

export type CollisionEvidence = {
  username: string;
  userIds: string[];
  sources: KeepSource[];
};

export type ClassifiedRemoteUser = {
  classification: ExclusiveClassification;
  userId: string;
  userName: string;
  displayName: string | null;
  applicationName: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  keepSources: KeepSource[];
  reason: string | null;
  sourceHint: "CURRENT_EPHEMERAL_E2E_USER" | null;
};

export type DeleteCandidate = {
  userId: string;
  userName: string;
  displayName: string | null;
  reason: "NO_CURRENT_APPLICATION_IDENTITY";
  sourceHint: "CURRENT_EPHEMERAL_E2E_USER" | null;
};

export type KeepIndex = {
  byUsername: Map<string, KeepUsernameRecord>;
  productionUsernames: Set<string>;
  localManualUsernames: Set<string>;
  managedUsernames: Set<string>;
  explicitUsernames: Set<string>;
  masterKeep: Set<string>;
  collisions: CollisionEvidence[];
  managedUsernamesList: string[];
};

export type ClassificationSummary = {
  totalVoxUsersInApplication: number;
  totalNgUUsers: number;
  keepProduction: number;
  keepLocalManual: number;
  keepManagedE2e: number;
  keepExplicit: number;
  overlap: number;
  ambiguousBlocked: number;
  deleteCandidates: number;
  outOfScope: number;
  masterKeep: number;
};

export type ClassificationReport = {
  summary: ClassificationSummary;
  classified: ClassifiedRemoteUser[];
  candidates: DeleteCandidate[];
  collisions: CollisionEvidence[];
  keepIndex: KeepIndex;
  candidateFingerprint: string;
};

export type KeepListLoadResult =
  | { ok: true; users: AppUserRow[]; source: string }
  | { ok: false; code: OrphanCleanupErrorCode; message: string };

export type RemoteInventoryLoadResult =
  | { ok: true; users: RemoteVoxUser[]; applicationName: string | null }
  | { ok: false; code: OrphanCleanupErrorCode; message: string };

export type OrphanCleanupLoaders = {
  loadProductionUsers: () => Promise<KeepListLoadResult>;
  loadLocalManualUsers: () => Promise<KeepListLoadResult>;
  loadE2eUsers?: () => Promise<KeepListLoadResult>;
  loadRemoteUsers: () => Promise<RemoteInventoryLoadResult>;
  loadExplicitUsernames?: () => string[];
};

export type OrphanCleanupMode = "dry-run" | "apply";

export type OrphanCleanupRunInput = {
  mode?: OrphanCleanupMode;
  expectedCount?: number;
  expectedUsernames?: string[];
  expectedFingerprint?: string;
  batchSize?: number;
  loaders: OrphanCleanupLoaders;
  deleteUser?: (candidate: DeleteCandidate) => Promise<void>;
};

export type OrphanCleanupRefusal = {
  ok: false;
  refused: true;
  code: OrphanCleanupErrorCode;
  message: string;
  delUserCalls: number;
  deletedUsernames: string[];
};

export type OrphanCleanupSuccess = {
  ok: true;
  refused: false;
  mode: OrphanCleanupMode;
  applicationName: string | null;
  productionSource: string;
  productionUserCount: number;
  localManualSource: string;
  localManualUserCount: number;
  e2eSource: string | null;
  e2eUserCount: number | null;
  managedKeepIds: string[];
  managedKeepUsernames: string[];
  explicitPocUsernames: string[];
  report: ClassificationReport;
  delUserCalls: number;
  deletedUsernames: string[];
  batchSize: number;
  batchFailurePolicy: "STOP_ON_FIRST_BATCH_FAILURE";
};

export type OrphanCleanupResult = OrphanCleanupSuccess | OrphanCleanupRefusal;

export type OrphanCleanupCliParseSuccess = {
  ok: true;
  mode: OrphanCleanupMode;
  expectedCount?: number;
  expectedUsernamesPath?: string;
  expectedFingerprint?: string;
  outDir?: string;
};

export type OrphanCleanupCliParseFailure = {
  ok: false;
  code: OrphanCleanupErrorCode;
  message: string;
};

const FORBIDDEN_CLI_PATTERNS = [
  /^--all$/,
  /^--user-id$/,
  /^--user_id$/,
  /^--user-name$/,
  /^--user_name$/,
  /^--prefix$/,
  /^user_id=all$/,
  /^user-id=all$/,
  /^user_name=all$/,
  /^user-name=all$/,
  /^--user-id=/,
  /^--user_id=/,
  /^--user-name=/,
  /^--user_name=/,
  /^--prefix=/,
];

const SOURCE_PRIORITY: KeepSource[] = [
  "PRODUCTION",
  "LOCAL_MANUAL",
  "MANAGED_E2E",
  "EXPLICIT",
];

function exclusiveFromSources(
  sources: KeepSource[],
): ExclusiveClassification | null {
  for (const source of SOURCE_PRIORITY) {
    if (sources.includes(source)) {
      if (source === "PRODUCTION") return "KEEP_PRODUCTION";
      if (source === "LOCAL_MANUAL") return "KEEP_LOCAL_MANUAL";
      if (source === "MANAGED_E2E") return "KEEP_MANAGED_E2E";
      return "KEEP_EXPLICIT";
    }
  }
  return null;
}

export function resolveManagedVoxE2EKeepUserIds(): string[] {
  return [...MANAGED_VOX_E2E_KEEP_USER_IDS];
}

export function collectExplicitPocUsernames(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const fromEnv = [
    env.VOXIMPLANT_PARTICIPANT_A_USER,
    env.VOXIMPLANT_PARTICIPANT_B_USER,
    env.VOXIMPLANT_FACILITATOR_USER,
  ]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);

  return [...new Set([...DOCUMENTED_VOX_POC_USERNAMES, ...fromEnv])];
}

export function fingerprintCandidates(candidates: DeleteCandidate[]): string {
  const lines = candidates
    .map((candidate) => `${candidate.userId}\t${candidate.userName}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

function uniqueUserIds(memberships: KeepMembership[]): string[] {
  return [
    ...new Set(
      memberships
        .map((membership) => membership.userId)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ];
}

function addKeepMembership(
  byUsername: Map<string, KeepUsernameRecord>,
  username: string,
  source: KeepSource,
  userId: string | null,
) {
  const existing = byUsername.get(username) ?? {
    username,
    memberships: [],
    userIds: [],
    ambiguous: false,
  };
  existing.memberships.push({ source, userId });
  existing.userIds = uniqueUserIds(existing.memberships);
  existing.ambiguous = existing.userIds.length > 1;
  byUsername.set(username, existing);
}

export function buildKeepIndex(params: {
  productionUsers: AppUserRow[];
  localManualUsers: AppUserRow[];
  managedUserIds?: readonly string[];
  explicitUsernames: readonly string[];
  buildUsername?: (userId: string) => string;
}): KeepIndex {
  const buildUsername = params.buildUsername ?? buildVoximplantUsernameForUser;
  const managedUserIds = params.managedUserIds ?? resolveManagedVoxE2EKeepUserIds();
  const byUsername = new Map<string, KeepUsernameRecord>();

  for (const user of params.productionUsers) {
    addKeepMembership(
      byUsername,
      buildUsername(user.id),
      "PRODUCTION",
      user.id,
    );
  }
  for (const user of params.localManualUsers) {
    addKeepMembership(
      byUsername,
      buildUsername(user.id),
      "LOCAL_MANUAL",
      user.id,
    );
  }
  for (const userId of managedUserIds) {
    addKeepMembership(
      byUsername,
      buildUsername(userId),
      "MANAGED_E2E",
      userId,
    );
  }
  for (const username of params.explicitUsernames) {
    const trimmed = username.trim();
    if (!trimmed) continue;
    addKeepMembership(byUsername, trimmed, "EXPLICIT", null);
  }

  const productionUsernames = new Set<string>();
  const localManualUsernames = new Set<string>();
  const managedUsernames = new Set<string>();
  const explicitUsernames = new Set<string>();
  const masterKeep = new Set<string>();
  const collisions: CollisionEvidence[] = [];

  for (const record of byUsername.values()) {
    const sources = new Set(record.memberships.map((item) => item.source));
    if (sources.has("PRODUCTION")) productionUsernames.add(record.username);
    if (sources.has("LOCAL_MANUAL")) localManualUsernames.add(record.username);
    if (sources.has("MANAGED_E2E")) managedUsernames.add(record.username);
    if (sources.has("EXPLICIT")) explicitUsernames.add(record.username);
    masterKeep.add(record.username);
    if (record.ambiguous) {
      collisions.push({
        username: record.username,
        userIds: record.userIds,
        sources: [...sources],
      });
    }
  }

  return {
    byUsername,
    productionUsernames,
    localManualUsernames,
    managedUsernames,
    explicitUsernames,
    masterKeep,
    collisions,
    managedUsernamesList: [...managedUsernames].sort(),
  };
}

export function assertManagedKeepComplete(keepIndex: KeepIndex): OrphanCleanupRefusal | null {
  const expectedIds = resolveManagedVoxE2EKeepUserIds();
  if (
    keepIndex.managedUsernames.size !== expectedIds.length ||
    keepIndex.managedUsernamesList.length !== expectedIds.length
  ) {
    return {
      ok: false,
      refused: true,
      code: "MANAGED_E2E_KEEP_INCOMPLETE",
      message:
        "Managed E2E keep-list did not resolve all four canonical identities.",
      delUserCalls: 0,
      deletedUsernames: [],
    };
  }
  return null;
}

export function classifyRemoteUsers(params: {
  remoteUsers: RemoteVoxUser[];
  keepIndex: KeepIndex;
  e2eEphemeralUsernames?: Set<string>;
}): ClassificationReport {
  const classified: ClassifiedRemoteUser[] = [];
  const candidates: DeleteCandidate[] = [];

  for (const remote of params.remoteUsers) {
    const keepRecord = params.keepIndex.byUsername.get(remote.userName);
    const keepSources = keepRecord
      ? [...new Set(keepRecord.memberships.map((item) => item.source))]
      : [];

    if (!isGeneratedVoximplantUsername(remote.userName)) {
      classified.push({
        classification: "OUT_OF_SCOPE",
        userId: remote.userId,
        userName: remote.userName,
        displayName: remote.userDisplayName,
        applicationName: remote.applicationName,
        createdAt: remote.createdAt,
        modifiedAt: remote.modifiedAt,
        keepSources,
        reason: "NOT_GENERATED_NG_U_USERNAME",
        sourceHint: null,
      });
      continue;
    }

    if (keepRecord?.ambiguous) {
      classified.push({
        classification: "AMBIGUOUS_BLOCKED",
        userId: remote.userId,
        userName: remote.userName,
        displayName: remote.userDisplayName,
        applicationName: remote.applicationName,
        createdAt: remote.createdAt,
        modifiedAt: remote.modifiedAt,
        keepSources,
        reason: "HASH_COLLISION_MULTIPLE_USER_IDS",
        sourceHint: null,
      });
      continue;
    }

    const exclusive = exclusiveFromSources(keepSources);
    if (exclusive) {
      classified.push({
        classification: exclusive,
        userId: remote.userId,
        userName: remote.userName,
        displayName: remote.userDisplayName,
        applicationName: remote.applicationName,
        createdAt: remote.createdAt,
        modifiedAt: remote.modifiedAt,
        keepSources,
        reason: null,
        sourceHint: null,
      });
      continue;
    }

    const sourceHint = params.e2eEphemeralUsernames?.has(remote.userName)
      ? "CURRENT_EPHEMERAL_E2E_USER"
      : null;
    const candidate: DeleteCandidate = {
      userId: remote.userId,
      userName: remote.userName,
      displayName: remote.userDisplayName,
      reason: "NO_CURRENT_APPLICATION_IDENTITY",
      sourceHint,
    };
    candidates.push(candidate);
    classified.push({
      classification: "DELETE_CANDIDATE",
      userId: remote.userId,
      userName: remote.userName,
      displayName: remote.userDisplayName,
      applicationName: remote.applicationName,
      createdAt: remote.createdAt,
      modifiedAt: remote.modifiedAt,
      keepSources,
      reason: candidate.reason,
      sourceHint,
    });
  }

  const ngU = classified.filter((row) =>
    isGeneratedVoximplantUsername(row.userName),
  );
  const keepProduction = ngU.filter((row) =>
    row.keepSources.includes("PRODUCTION"),
  ).length;
  const keepLocalManual = ngU.filter((row) =>
    row.keepSources.includes("LOCAL_MANUAL"),
  ).length;
  const keepManagedE2e = ngU.filter((row) =>
    row.keepSources.includes("MANAGED_E2E"),
  ).length;
  const keepExplicit = ngU.filter((row) =>
    row.keepSources.includes("EXPLICIT"),
  ).length;
  const overlap = ngU.filter((row) => row.keepSources.length > 1).length;

  return {
    summary: {
      totalVoxUsersInApplication: params.remoteUsers.length,
      totalNgUUsers: ngU.length,
      keepProduction,
      keepLocalManual,
      keepManagedE2e,
      keepExplicit,
      overlap,
      ambiguousBlocked: classified.filter(
        (row) => row.classification === "AMBIGUOUS_BLOCKED",
      ).length,
      deleteCandidates: candidates.length,
      outOfScope: classified.filter(
        (row) => row.classification === "OUT_OF_SCOPE",
      ).length,
      masterKeep: params.keepIndex.masterKeep.size,
    },
    classified,
    candidates,
    collisions: params.keepIndex.collisions,
    keepIndex: params.keepIndex,
    candidateFingerprint: fingerprintCandidates(candidates),
  };
}

export function parseOrphanCleanupCli(
  argv: string[],
): OrphanCleanupCliParseSuccess | OrphanCleanupCliParseFailure {
  for (const arg of argv) {
    if (FORBIDDEN_CLI_PATTERNS.some((pattern) => pattern.test(arg.toLowerCase()))) {
      return {
        ok: false,
        code: "WILDCARD_MODE_FORBIDDEN",
        message:
          "Wildcard / user_id=all / prefix deletion is not supported. Cleanup is hard-bounded to reviewed ng_u_* candidates.",
      };
    }
  }

  const apply = argv.includes("--apply");
  const dryRunFlag = argv.includes("--dry-run");
  if (apply && dryRunFlag) {
    return {
      ok: false,
      code: "APPLY_REQUIRES_EXPLICIT_FLAG",
      message: "Pass only one of --dry-run or --apply.",
    };
  }

  const expectedCountArg = readCliValue(argv, "--expected-count");
  const expectedUsernamesPath = readCliValue(argv, "--expected-usernames");
  const expectedFingerprint = readCliValue(argv, "--expected-fingerprint");
  const outDir = readCliValue(argv, "--out-dir");

  if (apply && expectedCountArg === undefined) {
    return {
      ok: false,
      code: "APPLY_REQUIRED_EXPECTED_COUNT",
      message: "--apply requires --expected-count N.",
    };
  }

  let expectedCount: number | undefined;
  if (expectedCountArg !== undefined) {
    expectedCount = Number(expectedCountArg);
    if (!Number.isInteger(expectedCount) || expectedCount < 0) {
      return {
        ok: false,
        code: "APPLY_REQUIRED_EXPECTED_COUNT",
        message: "--expected-count must be a non-negative integer.",
      };
    }
  }

  return {
    ok: true,
    mode: apply ? "apply" : "dry-run",
    expectedCount,
    expectedUsernamesPath,
    expectedFingerprint,
    outDir,
  };
}

function readCliValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  return argv[index + 1];
}

export function setsEqual(left: Iterable<string>, right: Iterable<string>): boolean {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function refuse(
  code: OrphanCleanupErrorCode,
  message: string,
): OrphanCleanupRefusal {
  return {
    ok: false,
    refused: true,
    code,
    message,
    delUserCalls: 0,
    deletedUsernames: [],
  };
}

export async function applyCandidateDeletes(params: {
  candidates: DeleteCandidate[];
  deleteUser: (candidate: DeleteCandidate) => Promise<void>;
  batchSize?: number;
}): Promise<{
  ok: boolean;
  delUserCalls: number;
  deletedUsernames: string[];
  failedBatchIndex: number | null;
  code?: OrphanCleanupErrorCode;
  message?: string;
}> {
  const batchSize = Math.max(
    1,
    Math.min(params.batchSize ?? VOX_ORPHAN_CLEANUP_BATCH_SIZE, 25),
  );
  const deletedUsernames: string[] = [];
  let delUserCalls = 0;

  for (let index = 0; index < params.candidates.length; index += batchSize) {
    const batch = params.candidates.slice(index, index + batchSize);
    for (const candidate of batch) {
      if (!isGeneratedVoximplantUsername(candidate.userName)) {
        return {
          ok: false,
          delUserCalls,
          deletedUsernames,
          failedBatchIndex: Math.floor(index / batchSize),
          code: "WILDCARD_MODE_FORBIDDEN",
          message: "Refusing delete of a non-generated username.",
        };
      }
      if (!/^\d+$/.test(candidate.userId) || candidate.userId.toLowerCase() === "all") {
        return {
          ok: false,
          delUserCalls,
          deletedUsernames,
          failedBatchIndex: Math.floor(index / batchSize),
          code: "WILDCARD_MODE_FORBIDDEN",
          message: "Refusing delete of a non-numeric or wildcard user id.",
        };
      }
    }

    try {
      for (const candidate of batch) {
        await params.deleteUser(candidate);
        delUserCalls += 1;
        deletedUsernames.push(candidate.userName);
      }
    } catch (error) {
      return {
        ok: false,
        delUserCalls,
        deletedUsernames,
        failedBatchIndex: Math.floor(index / batchSize),
        code: "BATCH_DELETE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "DelUser batch failed; later batches were not attempted.",
      };
    }
  }

  return {
    ok: true,
    delUserCalls,
    deletedUsernames,
    failedBatchIndex: null,
  };
}

export async function runOrphanUserCleanup(
  input: OrphanCleanupRunInput,
): Promise<OrphanCleanupResult> {
  const mode: OrphanCleanupMode = input.mode ?? "dry-run";
  const batchSize = input.batchSize ?? VOX_ORPHAN_CLEANUP_BATCH_SIZE;

  if (mode === "apply" && input.expectedCount === undefined) {
    return refuse(
      "APPLY_REQUIRED_EXPECTED_COUNT",
      "--apply requires --expected-count N.",
    );
  }

  const production = await input.loaders.loadProductionUsers();
  if (!production.ok) {
    return refuse(production.code, production.message);
  }

  const localManual = await input.loaders.loadLocalManualUsers();
  if (!localManual.ok) {
    return refuse(localManual.code, localManual.message);
  }

  const explicitUsernames =
    input.loaders.loadExplicitUsernames?.() ?? collectExplicitPocUsernames();

  const keepIndex = buildKeepIndex({
    productionUsers: production.users,
    localManualUsers: localManual.users,
    explicitUsernames,
  });
  const managedRefusal = assertManagedKeepComplete(keepIndex);
  if (managedRefusal) return managedRefusal;

  const remote = await input.loaders.loadRemoteUsers();
  if (!remote.ok) {
    return refuse(remote.code, remote.message);
  }

  let e2eSource: string | null = null;
  let e2eUserCount: number | null = null;
  let e2eEphemeralUsernames: Set<string> | undefined;
  if (input.loaders.loadE2eUsers) {
    const e2e = await input.loaders.loadE2eUsers();
    if (e2e.ok) {
      e2eSource = e2e.source;
      e2eUserCount = e2e.users.length;
      const managedIds = new Set(resolveManagedVoxE2EKeepUserIds());
      e2eEphemeralUsernames = new Set(
        e2e.users
          .filter((user) => !managedIds.has(user.id))
          .map((user) => buildVoximplantUsernameForUser(user.id)),
      );
    }
  }

  const report = classifyRemoteUsers({
    remoteUsers: remote.users,
    keepIndex,
    e2eEphemeralUsernames,
  });

  if (mode === "apply") {
    if (input.expectedCount !== report.candidates.length) {
      return refuse(
        "EXPECTED_COUNT_MISMATCH",
        `DELETE_CANDIDATE count ${report.candidates.length} != expected-count ${input.expectedCount}.`,
      );
    }
    if (
      input.expectedFingerprint &&
      input.expectedFingerprint !== report.candidateFingerprint
    ) {
      return refuse(
        "CANDIDATE_SET_DRIFT",
        "Candidate fingerprint drifted between dry-run and apply.",
      );
    }
    if (
      input.expectedUsernames &&
      !setsEqual(
        input.expectedUsernames,
        report.candidates.map((candidate) => candidate.userName),
      )
    ) {
      return refuse(
        "CANDIDATE_SET_DRIFT",
        "Candidate username set drifted between dry-run and apply.",
      );
    }
    if (!input.deleteUser) {
      return refuse(
        "APPLY_REQUIRES_EXPLICIT_FLAG",
        "Apply was requested without a delete adapter.",
      );
    }

    const applied = await applyCandidateDeletes({
      candidates: report.candidates,
      deleteUser: input.deleteUser,
      batchSize,
    });
    if (!applied.ok) {
      return {
        ok: false,
        refused: true,
        code: applied.code ?? "BATCH_DELETE_FAILED",
        message:
          applied.message ??
          "DelUser batch failed; later batches were not attempted.",
        delUserCalls: applied.delUserCalls,
        deletedUsernames: applied.deletedUsernames,
      };
    }

    return {
      ok: true,
      refused: false,
      mode,
      applicationName: remote.applicationName,
      productionSource: production.source,
      productionUserCount: production.users.length,
      localManualSource: localManual.source,
      localManualUserCount: localManual.users.length,
      e2eSource,
      e2eUserCount,
      managedKeepIds: resolveManagedVoxE2EKeepUserIds(),
      managedKeepUsernames: keepIndex.managedUsernamesList,
      explicitPocUsernames: [...explicitUsernames],
      report,
      delUserCalls: applied.delUserCalls,
      deletedUsernames: applied.deletedUsernames,
      batchSize,
      batchFailurePolicy: "STOP_ON_FIRST_BATCH_FAILURE",
    };
  }

  return {
    ok: true,
    refused: false,
    mode: "dry-run",
    applicationName: remote.applicationName,
    productionSource: production.source,
    productionUserCount: production.users.length,
    localManualSource: localManual.source,
    localManualUserCount: localManual.users.length,
    e2eSource,
    e2eUserCount,
    managedKeepIds: resolveManagedVoxE2EKeepUserIds(),
    managedKeepUsernames: keepIndex.managedUsernamesList,
    explicitPocUsernames: [...explicitUsernames],
    report,
    delUserCalls: 0,
    deletedUsernames: [],
    batchSize,
    batchFailurePolicy: "STOP_ON_FIRST_BATCH_FAILURE",
  };
}
