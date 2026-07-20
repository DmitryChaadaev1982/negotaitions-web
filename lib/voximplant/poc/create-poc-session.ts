import { createHash, randomBytes } from "node:crypto";

import { hash } from "bcryptjs";
import { Pool, type PoolClient } from "pg";

import {
  assertLocalDbWriteConfirmation,
  assertSafeLocalDatabaseTarget,
  type SanitizedDatabaseTarget,
} from "@/lib/voximplant/poc/local-db-safety";

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

export type CreateVoxServerStopPocSessionResult = {
  runId: string;
  namespace: string;
  sessionId: string;
  caseId: string;
  facilitatorUserId: string;
  facilitatorEmail: string;
  facilitatorPassword: string;
  facilitatorAuthCookie: string;
  facilitatorJoinToken: string;
  participantJoinToken: string;
  facilitatorRoomUrl: string;
  participantRoomUrl: string;
  roomUrl: string;
  cleanupManifest: PocCleanupManifest;
  localDatabaseTargetSanitized: string;
};

function namespaceForRun(runId: string): string {
  return `poc-vox-server-stop-${runId}`;
}

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

  const namespace = namespaceForRun(params.runId);
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

    const facilitatorPassword = "poc-vox-pass-1234";
    const passwordHash = await hash(facilitatorPassword, 10);
    const facilitatorUserId = pocId("user", params.runId);
    const facilitatorEmail = `${namespace}.facilitator@test.negotaitions.local`;

    await query(
      client,
      `INSERT INTO "User"
         ("id", "email", "passwordHash", "name", "role", "globalRole", "status",
          "preferredLocale", "updatedAt")
       VALUES ($1, $2, $3, $4, 'FACILITATOR', 'USER', 'ACTIVE', 'en', NOW())`,
      [
        facilitatorUserId,
        facilitatorEmail,
        passwordHash,
        `${namespace} Facilitator`,
      ],
    );
    track("User", facilitatorUserId);

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

    const participantJoinToken = `${namespace}-part-${randomBytes(4).toString("hex")}`;
    const participantId = pocId("sp", params.runId);
    await query(
      client,
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "sessionRoleId", "type", "joinToken",
          "displayName", "notes", "updatedAt")
       VALUES ($1, $2, $3, 'PARTICIPANT', $4, $5, $6, NOW())`,
      [
        participantId,
        sessionId,
        sessionRoleId,
        participantJoinToken,
        `${namespace} Participant`,
        namespace,
      ],
    );
    track("SessionParticipant", participantId);

    const rawAuthToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawAuthToken).digest("hex");
    const userSessionId = pocId("usess", params.runId);
    await query(
      client,
      `INSERT INTO "UserSession"
         ("id", "userId", "sessionTokenHash", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', NOW())`,
      [userSessionId, facilitatorUserId, tokenHash],
    );
    track("UserSession", userSessionId);

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

    return {
      runId: params.runId,
      namespace,
      sessionId,
      caseId,
      facilitatorUserId,
      facilitatorEmail,
      facilitatorPassword,
      facilitatorAuthCookie: `auth_session=${rawAuthToken}`,
      facilitatorJoinToken,
      participantJoinToken,
      facilitatorRoomUrl,
      participantRoomUrl,
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
