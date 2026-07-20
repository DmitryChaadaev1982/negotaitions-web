import { randomBytes } from "node:crypto";

import { hash } from "bcryptjs";
import { Pool, type PoolClient } from "pg";

import {
  generateSessionToken,
  hashSessionToken,
} from "@/lib/auth/crypto";
import {
  assertLocalDbWriteConfirmation,
  assertSafeLocalDatabaseTarget,
  type SanitizedDatabaseTarget,
} from "@/lib/voximplant/poc/local-db-safety";

/**
 * @deprecated Fixed password removed — fixtures generate unique per-run passwords.
 * Kept only so legacy test imports compile; never reuse for new fixtures.
 */
export const POC_FACILITATOR_PASSWORD = "poc-vox-pass-1234";
/** @deprecated See POC_FACILITATOR_PASSWORD. */
export const POC_PARTICIPANT_PASSWORD = POC_FACILITATOR_PASSWORD;

/** Generate a unique per-run local fixture password (process memory only). */
export function generatePocFixturePassword(): string {
  return `poc-vox-${randomBytes(12).toString("hex")}`;
}

export function namespaceForRunId(runId: string): string {
  return `poc-vox-server-stop-${runId}`;
}

export type PocCleanupEntityKind =
  | "UserSession"
  | "SessionParticipant"
  | "SessionRole"
  | "Session"
  | "CaseRole"
  | "NegotiationCase"
  | "User";

export type PocCleanupManifestEntry = {
  kind: PocCleanupEntityKind;
  id: string;
};

export type PocCleanupManifest = {
  runId: string;
  namespace: string;
  createdAt: string;
  databaseTargetSanitized: string;
  entities: PocCleanupManifestEntry[];
};

/** Canonical role auth for POC browsers — cookie value must never be logged. */
export type PocRoleAuthContext = {
  userId: string;
  email: string;
  password: string;
  /** Full header form: auth_session=<rawToken> (raw token, not UserSession.id). */
  authCookie: string;
  userSessionId: string;
  role: "FACILITATOR" | "PARTICIPANT";
};

export type CreateVoxServerStopPocSessionResult = {
  runId: string;
  namespace: string;
  sessionId: string;
  caseId: string;
  /** Facilitator identity + own UserSession cookie (never shared with participant). */
  facilitatorAuth: PocRoleAuthContext;
  /** Participant identity + own UserSession cookie (never facilitator privileges). */
  participantAuth: PocRoleAuthContext;
  facilitatorUserId: string;
  facilitatorEmail: string;
  facilitatorPassword: string;
  facilitatorAuthCookie: string;
  participantUserId: string;
  participantEmail: string;
  participantPassword: string;
  /** Participant's own auth_session — never the facilitator cookie. */
  participantAuthCookie: string;
  facilitatorJoinToken: string;
  participantJoinToken: string;
  facilitatorParticipantId: string;
  participantParticipantId: string;
  facilitatorRoomUrl: string;
  participantRoomUrl: string;
  /** Durable account-mode room URL after join-token claim (no joinToken query). */
  participantAccountRoomUrl: string;
  roomUrl: string;
  cleanupManifest: PocCleanupManifest;
  localDatabaseTargetSanitized: string;
};

function pocId(prefix: string, runId: string): string {
  const suffix = randomBytes(4).toString("hex");
  return `${prefix}_${runId.replace(/[^a-z0-9]/gi, "").slice(0, 18)}_${suffix}`;
}

async function query<T>(
  client: PoolClient,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await client.query(text, params);
  return result.rows as T[];
}

/**
 * Create the minimum temporary local entities for a full-mode POC run.
 * Uses DATABASE_URL only after local-host safety + explicit write confirmation.
 */
export async function createVoxServerStopPocSession(params: {
  runId: string;
  databaseUrl?: string;
  confirmLocalDbWrite: boolean;
  appBaseUrl?: string;
  poolFactory?: (connectionString: string) => Pool;
}): Promise<CreateVoxServerStopPocSessionResult> {
  assertLocalDbWriteConfirmation(params.confirmLocalDbWrite);

  const databaseUrl = params.databaseUrl ?? process.env.DATABASE_URL;
  const target: SanitizedDatabaseTarget =
    assertSafeLocalDatabaseTarget(databaseUrl);

  const namespace = namespaceForRunId(params.runId);
  const baseUrl = (params.appBaseUrl ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const poolFactory =
    params.poolFactory ?? ((connectionString: string) => new Pool({ connectionString }));
  const pool = poolFactory(databaseUrl!.trim());
  const client = await pool.connect();

  const entities: PocCleanupManifestEntry[] = [];
  const track = (kind: PocCleanupEntityKind, id: string) => {
    entities.push({ kind, id });
  };

  try {
    await client.query("BEGIN");

    const facilitatorPassword = generatePocFixturePassword();
    const participantPassword = generatePocFixturePassword();
    const facilitatorPasswordHash = await hash(facilitatorPassword, 10);
    const participantPasswordHash = await hash(participantPassword, 10);
    const facilitatorUserId = pocId("user", params.runId);
    const participantUserId = pocId("user", params.runId);
    const facilitatorEmail = `${namespace}.facilitator@test.negotaitions.local`;
    const participantEmail = `${namespace}.participant@test.negotaitions.local`;

    await query(
      client,
      `INSERT INTO "User"
         ("id", "email", "passwordHash", "name", "role", "globalRole", "status",
          "preferredLocale", "updatedAt")
       VALUES ($1, $2, $3, $4, 'FACILITATOR', 'USER', 'ACTIVE', 'en', NOW())`,
      [
        facilitatorUserId,
        facilitatorEmail,
        facilitatorPasswordHash,
        `${namespace} Facilitator`,
      ],
    );
    track("User", facilitatorUserId);

    await query(
      client,
      `INSERT INTO "User"
         ("id", "email", "passwordHash", "name", "role", "globalRole", "status",
          "preferredLocale", "updatedAt")
       VALUES ($1, $2, $3, $4, 'PARTICIPANT', 'USER', 'ACTIVE', 'en', NOW())`,
      [
        participantUserId,
        participantEmail,
        participantPasswordHash,
        `${namespace} Participant`,
      ],
    );
    track("User", participantUserId);

    const caseId = pocId("case", params.runId);
    await query(
      client,
      `INSERT INTO "NegotiationCase"
         ("id", "title", "description", "businessContext", "publicInstructions",
          "targetSkills", "difficulty", "caseLanguage",
          "defaultPreparationDurationSeconds", "defaultDurationSeconds",
          "facilitatorId", "createdByUserId", "visibility", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 'MEDIUM', 'EN', 60, 900, $7, $7, 'PRIVATE', NOW())`,
      [
        caseId,
        `${namespace} Case`,
        `${namespace} description`,
        `${namespace} business context`,
        `${namespace} public instructions`,
        "POC",
        facilitatorUserId,
      ],
    );
    track("NegotiationCase", caseId);

    const caseRoleId = pocId("caserole", params.runId);
    await query(
      client,
      `INSERT INTO "CaseRole"
         ("id", "negotiationCaseId", "name", "privateInstructions", "objectives",
          "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "updatedAt")
       VALUES ($1, $2, 'Buyer', $3, $4, $5, $6, $7, 0, NOW())`,
      [
        caseRoleId,
        caseId,
        `${namespace} private`,
        `${namespace} objectives`,
        `${namespace} constraints`,
        `${namespace} hidden`,
        `${namespace} fallback`,
      ],
    );
    track("CaseRole", caseRoleId);

    const sessionId = pocId("session", params.runId);
    await query(
      client,
      `INSERT INTO "Session"
         ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
          "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
          "status", "preparationDurationSeconds", "durationSeconds", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN', 'READY', 60, 900, NOW())`,
      [
        sessionId,
        caseId,
        facilitatorUserId,
        `${namespace} Session`,
        `${namespace} Case`,
        `${namespace} business context`,
        `${namespace} public instructions`,
      ],
    );
    track("Session", sessionId);

    const sessionRoleId = pocId("srole", params.runId);
    await query(
      client,
      `INSERT INTO "SessionRole"
         ("id", "sessionId", "name", "privateInstructions", "objectives",
          "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "updatedAt")
       VALUES ($1, $2, 'Buyer', $3, $4, $5, $6, $7, 0, NOW())`,
      [
        sessionRoleId,
        sessionId,
        `${namespace} private`,
        `${namespace} objectives`,
        `${namespace} constraints`,
        `${namespace} hidden`,
        `${namespace} fallback`,
      ],
    );
    track("SessionRole", sessionRoleId);

    const facilitatorJoinToken = `${namespace}-fac-${randomBytes(4).toString("hex")}`;
    const facilitatorParticipantId = pocId("sp", params.runId);
    await query(
      client,
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "userId", "sessionRoleId", "type", "joinToken",
          "displayName", "notes", "updatedAt")
       VALUES ($1, $2, $3, NULL, 'FACILITATOR', $4, $5, $6, NOW())`,
      [
        facilitatorParticipantId,
        sessionId,
        facilitatorUserId,
        facilitatorJoinToken,
        `${namespace} Facilitator`,
        namespace,
      ],
    );
    track("SessionParticipant", facilitatorParticipantId);

    // Guest access is closed: joinToken is invite-claim only. Pre-bind the
    // participant User (same pattern as E2E voximplant room fixtures) so the
    // browser can authenticate with its own auth_session and enter via the
    // canonical join-token URL without a guest identity.
    const participantJoinToken = `${namespace}-part-${randomBytes(4).toString("hex")}`;
    const participantId = pocId("sp", params.runId);
    await query(
      client,
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "userId", "sessionRoleId", "type", "joinToken",
          "displayName", "notes", "updatedAt")
       VALUES ($1, $2, $3, $4, 'PARTICIPANT', $5, $6, $7, NOW())`,
      [
        participantId,
        sessionId,
        participantUserId,
        sessionRoleId,
        participantJoinToken,
        `${namespace} Participant`,
        namespace,
      ],
    );
    track("SessionParticipant", participantId);

    // Canonical auth_session value: raw unhashed session token (same as E2E /
    // lib/auth createUserSession). Never put UserSession.id or User.id here.
    const facilitatorRawAuthToken = generateSessionToken();
    const facilitatorTokenHash = hashSessionToken(facilitatorRawAuthToken);
    const facilitatorUserSessionId = pocId("usess", params.runId);
    await query(
      client,
      `INSERT INTO "UserSession"
         ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', NOW())`,
      [facilitatorUserSessionId, facilitatorUserId, facilitatorTokenHash],
    );
    track("UserSession", facilitatorUserSessionId);

    const participantRawAuthToken = generateSessionToken();
    const participantTokenHash = hashSessionToken(participantRawAuthToken);
    const participantUserSessionId = pocId("usess", params.runId);
    await query(
      client,
      `INSERT INTO "UserSession"
         ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', NOW())`,
      [participantUserSessionId, participantUserId, participantTokenHash],
    );
    track("UserSession", participantUserSessionId);

    await client.query("COMMIT");

    const cleanupManifest: PocCleanupManifest = {
      runId: params.runId,
      namespace,
      createdAt: new Date().toISOString(),
      databaseTargetSanitized: target.sanitizedUrl,
      entities,
    };

    const facilitatorRoomUrl = `${baseUrl}/room/${sessionId}?joinToken=${encodeURIComponent(facilitatorJoinToken)}`;
    const participantRoomUrl = `${baseUrl}/room/${sessionId}?joinToken=${encodeURIComponent(participantJoinToken)}`;
    const participantAccountRoomUrl = `${baseUrl}/room/${sessionId}`;

    const facilitatorAuthCookie = `auth_session=${facilitatorRawAuthToken}`;
    const participantAuthCookie = `auth_session=${participantRawAuthToken}`;
    const facilitatorAuth: PocRoleAuthContext = {
      userId: facilitatorUserId,
      email: facilitatorEmail,
      password: facilitatorPassword,
      authCookie: facilitatorAuthCookie,
      userSessionId: facilitatorUserSessionId,
      role: "FACILITATOR",
    };
    const participantAuth: PocRoleAuthContext = {
      userId: participantUserId,
      email: participantEmail,
      password: participantPassword,
      authCookie: participantAuthCookie,
      userSessionId: participantUserSessionId,
      role: "PARTICIPANT",
    };

    return {
      runId: params.runId,
      namespace,
      sessionId,
      caseId,
      facilitatorAuth,
      participantAuth,
      facilitatorUserId,
      facilitatorEmail,
      facilitatorPassword,
      facilitatorAuthCookie,
      participantUserId,
      participantEmail,
      participantPassword,
      participantAuthCookie,
      facilitatorJoinToken,
      participantJoinToken,
      facilitatorParticipantId,
      participantParticipantId: participantId,
      facilitatorRoomUrl,
      participantRoomUrl,
      participantAccountRoomUrl,
      roomUrl: facilitatorRoomUrl,
      cleanupManifest,
      localDatabaseTargetSanitized: target.sanitizedUrl,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

/**
 * Delete only entities listed in the cleanup manifest (child → parent order).
 */
export async function cleanupPocSessionEntities(params: {
  manifest: PocCleanupManifest;
  databaseUrl?: string;
  confirmLocalDbWrite: boolean;
  dryRun?: boolean;
  poolFactory?: (connectionString: string) => Pool;
}): Promise<{ deleted: PocCleanupManifestEntry[]; dryRun: boolean }> {
  assertLocalDbWriteConfirmation(params.confirmLocalDbWrite);
  const databaseUrl = params.databaseUrl ?? process.env.DATABASE_URL;
  assertSafeLocalDatabaseTarget(databaseUrl);

  if (params.dryRun) {
    return { deleted: params.manifest.entities, dryRun: true };
  }

  const order: PocCleanupEntityKind[] = [
    "UserSession",
    "SessionParticipant",
    "SessionRole",
    "Session",
    "CaseRole",
    "NegotiationCase",
    "User",
  ];

  const poolFactory =
    params.poolFactory ?? ((connectionString: string) => new Pool({ connectionString }));
  const pool = poolFactory(databaseUrl!.trim());
  const client = await pool.connect();
  const deleted: PocCleanupManifestEntry[] = [];

  try {
    await client.query("BEGIN");
    for (const kind of order) {
      const ids = params.manifest.entities
        .filter((entry) => entry.kind === kind)
        .map((entry) => entry.id);
      if (ids.length === 0) continue;
      await query(client, `DELETE FROM "${kind}" WHERE "id" = ANY($1)`, [ids]);
      for (const id of ids) deleted.push({ kind, id });
    }
    await client.query("COMMIT");
    return { deleted, dryRun: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}
