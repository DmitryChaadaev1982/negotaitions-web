import "dotenv/config";

import { hash } from "bcryptjs";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function query<T>(text: string, params: unknown[] = []) {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export const e2eRoleMarkers = {
  igor: "E2E_PRIVATE_IGOR_ONLY",
  alex: "E2E_PRIVATE_ALEX_ONLY",
};

export type E2eCaseRole = {
  id: string;
  name: string;
  privateInstructions: string;
  objectives: string;
  constraints: string;
  hiddenInfo: string;
  fallbackPosition: string;
  sortOrder: number;
};

export type E2eCase = {
  id: string;
  title: string;
  businessContext: string;
  publicInstructions: string;
  caseLanguage: "RU" | "EN";
  roles: E2eCaseRole[];
};

export type E2eEventParticipant = {
  id: string;
  eventId: string;
  displayName: string;
  participantToken: string;
  isHost: boolean;
  assignedSessionId: string | null;
  assignedSessionParticipantId: string | null;
};

export type E2eEvent = {
  id: string;
  title: string;
  publicJoinCode: string;
  hostToken: string;
  estimatedEventDurationSeconds: number | null;
  participants: E2eEventParticipant[];
};

export type E2eSessionParticipant = {
  id: string;
  sessionId: string;
  displayName: string;
  type: "PARTICIPANT" | "OBSERVER" | "FACILITATOR";
  joinToken: string;
  notes: string;
  sessionRoleId: string | null;
  sessionRole?: { id: string; name: string } | null;
};

export type E2eSession = {
  id: string;
  title: string;
  eventId: string | null;
  snapshotCaseTitle: string;
  preparationDurationSeconds: number;
  durationSeconds: number;
  participants: E2eSessionParticipant[];
  sessionRoles: Array<{ id: string; name: string; sortOrder: number }>;
};

export type E2eRecording = {
  id: string;
  sessionId: string;
  status: string;
  fileKey: string | null;
  fileName: string | null;
  mimeType: string | null;
};

export async function cleanupE2eData() {
  await query(`DELETE FROM "Session" WHERE "title" LIKE '%E2E%' OR "snapshotCaseTitle" LIKE '%E2E%'`);
  await query(`DELETE FROM "TrainingEvent" WHERE "title" LIKE '%E2E%'`);
  await query(`DELETE FROM "NegotiationCase" WHERE "title" LIKE '%E2E%'`);
  await query(
    `DELETE FROM "ExternalServiceEvent" WHERE "title" LIKE '%Mock%' OR "message" LIKE '%Mock%' OR "message" LIKE '%quota%' OR "message" LIKE '%billing%'`,
  );
}

export async function ensureDemoFacilitator() {
  const passwordHash = await hash("demo1234", 10);
  const rows = await query<{ id: string; email: string }>(
    `INSERT INTO "User" ("id", "email", "passwordHash", "name", "role", "updatedAt")
     VALUES ($1, 'demo@example.com', $2, 'Demo Facilitator', 'FACILITATOR', NOW())
     ON CONFLICT ("email") DO UPDATE
       SET "name" = 'Demo Facilitator',
           "role" = 'FACILITATOR',
           "updatedAt" = NOW()
     RETURNING "id", "email"`,
    [id("user"), passwordHash],
  );
  return rows[0]!;
}

export async function createE2eCase() {
  const facilitator = await ensureDemoFacilitator();
  const caseId = id("case");
  const title = `E2E Case Duration Test ${Date.now()}`;

  await query(
    `INSERT INTO "NegotiationCase"
       ("id", "title", "description", "businessContext", "publicInstructions",
        "targetSkills", "difficulty", "caseLanguage",
        "defaultPreparationDurationSeconds", "defaultDurationSeconds",
        "facilitatorId", "updatedAt")
     VALUES ($1, $2, 'E2E case description', 'E2E public business context',
        'E2E public instructions', 'E2E target skills', 'MEDIUM', 'EN',
        300, 900, $3, NOW())`,
    [caseId, title, facilitator.id],
  );

  const roleRows = await query<E2eCaseRole>(
    `INSERT INTO "CaseRole"
       ("id", "negotiationCaseId", "name", "privateInstructions", "objectives",
        "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "updatedAt")
     VALUES
       ($1, $3, 'Buyer', $4, 'Buyer objective', 'Buyer constraints', 'Buyer hidden info', 'Buyer fallback', 0, NOW()),
       ($2, $3, 'Seller', $5, 'Seller objective', 'Seller constraints', 'Seller hidden info', 'Seller fallback', 1, NOW())
     RETURNING "id", "name", "privateInstructions", "objectives", "constraints", "hiddenInfo", "fallbackPosition", "sortOrder"`,
    [id("role"), id("role"), caseId, e2eRoleMarkers.igor, e2eRoleMarkers.alex],
  );

  return {
    id: caseId,
    title,
    businessContext: "E2E public business context",
    publicInstructions: "E2E public instructions",
    caseLanguage: "EN" as const,
    roles: roleRows.sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

export async function createTestCase(input?: {
  title?: string;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  preparationSeconds?: number;
  negotiationSeconds?: number;
  roles?: [string, string];
}) {
  const facilitator = await ensureDemoFacilitator();
  const caseId = id("case");
  const title = input?.title ?? "E2E Case A — Scope Change";
  const [roleA, roleB] = input?.roles ?? ["Client CFO", "Vendor Project Director"];

  await query(
    `INSERT INTO "NegotiationCase"
       ("id", "title", "description", "businessContext", "publicInstructions",
        "targetSkills", "difficulty", "caseLanguage",
        "defaultPreparationDurationSeconds", "defaultDurationSeconds",
        "facilitatorId", "updatedAt")
     VALUES ($1, $2, 'E2E case description', $3,
        'E2E public instructions', 'E2E target skills', $4, 'EN',
        $5, $6, $7, NOW())`,
    [
      caseId,
      title,
      `${title} public business context`,
      input?.difficulty ?? "EASY",
      input?.preparationSeconds ?? 5 * 60,
      input?.negotiationSeconds ?? 10 * 60,
      facilitator.id,
    ],
  );

  const roleRows = await query<E2eCaseRole>(
    `INSERT INTO "CaseRole"
       ("id", "negotiationCaseId", "name", "privateInstructions", "objectives",
        "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "updatedAt")
     VALUES
       ($1, $3, $4, $6, 'Role A objective', 'Role A constraints', 'Role A hidden info', 'Role A fallback', 0, NOW()),
       ($2, $3, $5, $7, 'Role B objective', 'Role B constraints', 'Role B hidden info', 'Role B fallback', 1, NOW())
     RETURNING "id", "name", "privateInstructions", "objectives", "constraints", "hiddenInfo", "fallbackPosition", "sortOrder"`,
    [
      id("role"),
      id("role"),
      caseId,
      roleA,
      roleB,
      `E2E_PRIVATE_${roleA.replace(/\W+/g, "_").toUpperCase()}_ONLY`,
      `E2E_PRIVATE_${roleB.replace(/\W+/g, "_").toUpperCase()}_ONLY`,
    ],
  );

  return {
    id: caseId,
    title,
    businessContext: `${title} public business context`,
    publicInstructions: "E2E public instructions",
    caseLanguage: "EN" as const,
    roles: roleRows.sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

export async function createTestEvent(input?: {
  withParticipants?: boolean;
  title?: string;
}) {
  return createE2eEvent(input);
}

export async function joinEventAsParticipant(
  eventId: string,
  name: string,
  preference: "PLAY" | "OBSERVE" | "FACILITATE" = "PLAY",
) {
  const token = `${name.toLowerCase()}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;

  await query(
    `INSERT INTO "EventParticipant"
      ("id", "eventId", "displayName", "participantToken", "preference",
       "isHost", "wantsToPlay", "wantsToObserve", "wantsToFacilitate",
       "joinedAt", "lastSeenAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, NOW(), NOW(), NOW())`,
    [
      id("ep"),
      eventId,
      name,
      token,
      preference,
      preference === "PLAY",
      preference === "OBSERVE",
      preference === "FACILITATE",
    ],
  );

  return participantByName(await getEventParticipants(eventId), name);
}

export async function createE2eEvent(input?: {
  withParticipants?: boolean;
  title?: string;
}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const eventId = id("event");
  const title = input?.title ?? `E2E Club Event ${suffix}`;
  const hostToken = `host-${suffix}`;
  const publicJoinCode = `e2e-${suffix}`;

  await query(
    `INSERT INTO "TrainingEvent"
       ("id", "title", "description", "status", "publicJoinCode", "hostToken",
        "lobbyRoomName", "estimatedEventDurationSeconds", "updatedAt")
     VALUES ($1, $2, 'E2E event description', 'LOBBY_OPEN', $3, $4, $5, 5400, NOW())`,
    [eventId, title, publicJoinCode, hostToken, `event-lobby-e2e-${suffix}`],
  );

  if (input?.withParticipants) {
    await query(
      `INSERT INTO "EventParticipant"
        ("id", "eventId", "displayName", "participantToken", "preference",
         "isHost", "wantsToPlay", "wantsToObserve", "wantsToFacilitate",
         "joinedAt", "lastSeenAt", "updatedAt")
       VALUES
        ($1, $5, 'Dmitry', $6, 'FACILITATE', true, false, false, true, NOW(), NOW(), NOW()),
        ($2, $5, 'Igor', $7, 'PLAY', false, true, false, false, NOW(), NOW(), NOW()),
        ($3, $5, 'Alex', $8, 'PLAY', false, true, false, false, NOW(), NOW(), NOW()),
        ($4, $5, 'Serg', $9, 'OBSERVE', false, false, true, false, NOW(), NOW(), NOW())`,
      [
        id("ep"),
        id("ep"),
        id("ep"),
        id("ep"),
        eventId,
        `dmitry-${suffix}`,
        `igor-${suffix}`,
        `alex-${suffix}`,
        `serg-${suffix}`,
      ],
    );
  }

  const participants = await getEventParticipants(eventId);

  return {
    id: eventId,
    title,
    publicJoinCode,
    hostToken,
    estimatedEventDurationSeconds: 90 * 60,
    participants,
  };
}

export async function getEventParticipants(eventId: string) {
  return query<E2eEventParticipant>(
    `SELECT "id", "eventId", "displayName", "participantToken", "isHost",
            "assignedSessionId", "assignedSessionParticipantId"
     FROM "EventParticipant"
     WHERE "eventId" = $1
     ORDER BY "createdAt" ASC`,
    [eventId],
  );
}

export function participantByName<
  T extends { displayName: string },
>(participants: T[], displayName: string) {
  const participant = participants.find((item) => item.displayName === displayName);
  if (!participant) {
    throw new Error(`Missing participant ${displayName}`);
  }
  return participant;
}

export async function softDeleteCase(caseId: string) {
  await query(
    `UPDATE "NegotiationCase" SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE "id" = $1`,
    [caseId],
  );
}

export async function countEventParticipants(eventId: string) {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "EventParticipant" WHERE "eventId" = $1`,
    [eventId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getTrainingEvent(eventId: string) {
  return (
    await query<
      E2eEvent & {
        status: string;
        completedAt: string | null;
        completionReason: string | null;
      }
    >(
      `SELECT "id", "title", "publicJoinCode", "hostToken", "estimatedEventDurationSeconds",
              "status", "completedAt", "completionReason"
       FROM "TrainingEvent"
       WHERE "id" = $1`,
      [eventId],
    )
  )[0]!;
}

export async function getSessionNegotiationState(sessionId: string) {
  return (
    await query<{
      negotiationState: string;
      closeReason: string | null;
      closedByEventAt: string | null;
      status: string;
      negotiationStartedAt: string | null;
    }>(
      `SELECT "negotiationState", "closeReason", "closedByEventAt", "status", "negotiationStartedAt"
       FROM "Session"
       WHERE "id" = $1`,
      [sessionId],
    )
  )[0]!;
}

export async function getSession(sessionId: string): Promise<E2eSession> {
  const session = (
    await query<Omit<E2eSession, "participants" | "sessionRoles">>(
      `SELECT "id", "title", "eventId", "snapshotCaseTitle",
              "preparationDurationSeconds", "durationSeconds"
       FROM "Session"
       WHERE "id" = $1`,
      [sessionId],
    )
  )[0]!;

  const sessionRoles = await query<{ id: string; name: string; sortOrder: number }>(
    `SELECT "id", "name", "sortOrder" FROM "SessionRole" WHERE "sessionId" = $1 ORDER BY "sortOrder" ASC`,
    [sessionId],
  );

  const participants = await query<E2eSessionParticipant & { roleId: string | null; roleName: string | null }>(
    `SELECT p."id", p."sessionId", p."displayName", p."type", p."joinToken", p."notes",
            p."sessionRoleId", r."id" AS "roleId", r."name" AS "roleName"
     FROM "SessionParticipant" p
     LEFT JOIN "SessionRole" r ON r."id" = p."sessionRoleId"
     WHERE p."sessionId" = $1
     ORDER BY p."createdAt" ASC`,
    [sessionId],
  );

  return {
    ...session,
    sessionRoles,
    participants: participants.map((participant) => ({
      ...participant,
      sessionRole: participant.roleId
        ? { id: participant.roleId, name: participant.roleName! }
        : null,
    })),
  };
}

export async function getRecordingBySession(sessionId: string) {
  return (
    await query<E2eRecording>(
      `SELECT "id", "sessionId", "status", "fileKey", "fileName", "mimeType"
       FROM "Recording"
       WHERE "sessionId" = $1`,
      [sessionId],
    )
  )[0] ?? null;
}

export async function countTranscripts(sessionId: string) {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "Transcript" WHERE "sessionId" = $1`,
    [sessionId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function updateParticipantNotes(participantId: string, notes: string) {
  await query(
    `UPDATE "SessionParticipant" SET "notes" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
    [participantId, notes],
  );
}

export async function getExternalServiceEvent(sessionId: string, service: string) {
  return (
    await query<{ errorCode: string | null }>(
      `SELECT "errorCode" FROM "ExternalServiceEvent"
       WHERE "sessionId" = $1 AND "service" = $2
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [sessionId, service],
    )
  )[0] ?? null;
}

export async function updateRecordingCompleted(sessionId: string) {
  return (
    await query<E2eRecording>(
      `UPDATE "Recording"
       SET "status" = 'COMPLETED',
           "fileKey" = $2,
           "fileName" = 'mock-audio.mp4',
           "mimeType" = 'audio/mp4',
           "updatedAt" = NOW()
       WHERE "sessionId" = $1
       RETURNING "id", "sessionId", "status", "fileKey", "fileName", "mimeType"`,
      [sessionId, `recordings/${sessionId}/mock-audio.mp4`],
    )
  )[0]!;
}

export async function createManualTranscript(
  sessionId: string,
  recordingId: string | null,
  text: string,
) {
  await query(
    `INSERT INTO "Transcript" ("id", "sessionId", "recordingId", "source", "text", "updatedAt")
     VALUES ($1, $2, $3, 'MANUAL', $4, NOW())`,
    [id("transcript"), sessionId, recordingId, text],
  );
}

export async function getTranscriptText(sessionId: string) {
  const rows = await query<{ text: string }>(
    `SELECT "text" FROM "Transcript" WHERE "sessionId" = $1`,
    [sessionId],
  );
  return rows[0]?.text ?? null;
}

export async function getExternalServiceNames(sessionId: string) {
  const rows = await query<{ service: string }>(
    `SELECT "service" FROM "ExternalServiceEvent" WHERE "sessionId" = $1`,
    [sessionId],
  );
  return rows.map((row) => row.service);
}

export async function createSnapshotJoinFixture() {
  const facilitator = await ensureDemoFacilitator();
  const negotiationCase = await createE2eCase();
  const sessionId = id("session");

  await query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "preparationDurationSeconds", "durationSeconds", "updatedAt")
     VALUES ($1, $2, $3, 'E2E i18n Snapshot Session', $4,
        'E2E_DYNAMIC_CASE_TEXT_STAYS_ENGLISH', 'E2E_DYNAMIC_PUBLIC_INSTRUCTIONS',
        'EN', 300, 900, NOW())`,
    [sessionId, negotiationCase.id, facilitator.id, negotiationCase.title],
  );

  const firstRole = negotiationCase.roles[0]!;
  const sessionRoleId = id("session_role");
  await query(
    `INSERT INTO "SessionRole"
       ("id", "sessionId", "name", "privateInstructions", "objectives",
        "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, NOW())`,
    [
      sessionRoleId,
      sessionId,
      firstRole.name,
      firstRole.privateInstructions,
      firstRole.objectives,
      firstRole.constraints,
      firstRole.hiddenInfo,
      firstRole.fallbackPosition,
    ],
  );

  const joinToken = `e2e-join-${Date.now()}`;
  await query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "sessionRoleId", "type", "joinToken", "displayName", "notes", "updatedAt")
     VALUES ($1, $2, $3, 'PARTICIPANT', $4, 'Igor', 'E2E_DYNAMIC_NOTE_NOT_TRANSLATED', NOW())`,
    [id("sp"), sessionId, sessionRoleId, joinToken],
  );

  await createManualTranscript(
    sessionId,
    null,
    "E2E_DYNAMIC_TRANSCRIPT_NOT_TRANSLATED",
  );

  return { joinToken };
}

