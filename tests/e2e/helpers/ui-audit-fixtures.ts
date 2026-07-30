import { createActiveUser, e2eEmail, e2eId, e2eName, getE2eRunId, query } from "./db";

export type AuditUser = Awaited<ReturnType<typeof createActiveUser>>;

type AuditCaseRole = {
  id: string;
  name: string;
};

export type AuditCase = {
  id: string;
  title: string;
  roles: AuditCaseRole[];
};

export type AuditSessionParticipant = {
  id: string;
  displayName: string;
  type: "PARTICIPANT" | "OBSERVER" | "FACILITATOR";
  joinToken: string;
  roleId: string | null;
};

export type AuditSession = {
  id: string;
  title: string;
  eventId: string | null;
  participants: AuditSessionParticipant[];
};

export type AuditEventParticipant = {
  id: string;
  displayName: string;
  participantToken: string;
};

export type AuditEvent = {
  id: string;
  title: string;
  hostToken: string;
  publicJoinCode: string;
  participants: AuditEventParticipant[];
  sessions: AuditSession[];
};

const LONG_RU_TITLE =
  "Очень длинная учебная встреча по переговорам о стратегическом партнерстве и распределении рисков";
const LONG_EN_TITLE =
  "Very Long Negotiation Training Event About Strategic Partnership Risk Allocation and Governance";

export async function createUiAuditUser(input?: { preferredLocale?: "ru" | "en"; name?: string }) {
  const user = await createActiveUser({
    email: e2eEmail(`ui-audit-user-${input?.preferredLocale ?? "ru"}`),
    preferredLocale: input?.preferredLocale ?? "ru",
  });
  if (input?.name) {
    await query(`UPDATE "User" SET "name" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
      user.id,
      input.name,
    ]);
  }
  return user;
}

export async function createUiAuditCase(input?: {
  facilitatorUserId?: string;
  roleCount?: number;
  language?: "RU" | "EN";
  longContent?: boolean;
}) {
  const facilitatorUserId = input?.facilitatorUserId ?? (await createUiAuditUser()).id;
  const roleCount = input?.roleCount ?? 2;
  const language = input?.language ?? "RU";
  const caseId = e2eId("ui-audit-case");
  const title = e2eName(
    input?.longContent
      ? language === "RU"
        ? "Длинный кейс о закупке промышленной линии с сервисными обязательствами"
        : "Long Case About Industrial Line Procurement With Service Commitments"
      : "UI Audit Case",
  );

  await query(
    `INSERT INTO "NegotiationCase"
       ("id", "title", "description", "businessContext", "publicInstructions",
        "targetSkills", "difficulty", "caseLanguage",
        "defaultPreparationDurationSeconds", "defaultDurationSeconds",
        "facilitatorId", "createdByUserId", "visibility", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'Audit target skills', 'MEDIUM', $6,
        300, 900, $7, $7, 'PUBLIC', NOW())`,
    [
      caseId,
      title,
      input?.longContent
        ? "Audit case description with deliberately long public context that should remain readable before preparation, during room work, and in debrief materials."
        : "Audit case description",
      "Audit business context for deterministic UI inspection.",
      "Audit public instructions for deterministic UI inspection.",
      language,
      facilitatorUserId,
    ],
  );

  const roleNames = Array.from({ length: roleCount }, (_, index) => {
    if (index === 0) return language === "RU" ? "Покупатель" : "Buyer";
    if (index === 1) return language === "RU" ? "Продавец" : "Seller";
    return language === "RU"
      ? `Дополнительная переговорная роль ${index + 1}`
      : `Additional negotiator role ${index + 1}`;
  });

  const roles: AuditCaseRole[] = [];
  for (let index = 0; index < roleNames.length; index += 1) {
    const roleId = e2eId("ui-audit-role");
    await query(
      `INSERT INTO "CaseRole"
         ("id", "negotiationCaseId", "name", "privateInstructions", "objectives",
          "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        roleId,
        caseId,
        roleNames[index],
        `Private instructions for ${roleNames[index]}`,
        `Objectives for ${roleNames[index]}`,
        `Constraints for ${roleNames[index]}`,
        `Hidden information for ${roleNames[index]}`,
        `Fallback position for ${roleNames[index]}`,
        index,
      ],
    );
    roles.push({ id: roleId, name: roleNames[index]! });
  }

  return { id: caseId, title, roles };
}

export async function createUiAuditEvent(input: {
  hostUserId: string;
  facilitatorUserId?: string;
  title?: string;
  peopleCount: number;
  sessionCount?: number;
  language?: "RU" | "EN";
  completed?: boolean;
  longNames?: boolean;
}) {
  const eventId = e2eId("ui-audit-event");
  const suffix = `${getE2eRunId()}-${Math.random().toString(36).slice(2, 7)}`;
  const language = input.language ?? "RU";
  const hostToken = `ui-audit-host-${suffix}`;
  const publicJoinCode = `ui-audit-${suffix}`;
  const title =
    input.title ??
    e2eName(language === "RU" ? LONG_RU_TITLE : LONG_EN_TITLE);

  await query(
    `INSERT INTO "TrainingEvent"
       ("id", "title", "description", "status", "publicJoinCode", "hostToken",
        "lobbyRoomName", "hostUserId", "facilitatorUserId", "visibility",
        "estimatedEventDurationSeconds", "updatedAt")
     VALUES ($1, $2, 'UI audit event description', $3, $4, $5, $6, $7, $8,
       'PUBLIC', 5400, NOW())`,
    [
      eventId,
      title,
      input.completed ? "COMPLETED" : "LOBBY_OPEN",
      publicJoinCode,
      hostToken,
      `ui-audit-lobby-${suffix}`,
      input.hostUserId,
      input.facilitatorUserId ?? input.hostUserId,
    ],
  );

  const participants: AuditEventParticipant[] = [];
  for (let index = 0; index < input.peopleCount; index += 1) {
    const participantId = e2eId("ui-audit-ep");
    const displayName = input.longNames
      ? `${index + 1}. Very Long Participant Name With Repeated Family Segment ${suffix.slice(0, 4)}`
      : `Audit Person ${index + 1}`;
    const preference =
      index === 0 ? "FACILITATE" : index % 5 === 0 ? "OBSERVE" : "PLAY";
    await query(
      `INSERT INTO "EventParticipant"
        ("id", "eventId", "userId", "displayName", "participantToken", "preference",
         "isHost", "wantsToPlay", "wantsToObserve", "wantsToFacilitate",
         "joinedAt", "lastSeenAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), NOW())`,
      [
        participantId,
        eventId,
        index === 0 ? input.hostUserId : null,
        displayName,
        `ui-audit-participant-${suffix}-${index}`,
        preference,
        index === 0,
        preference === "PLAY",
        preference === "OBSERVE",
        preference === "FACILITATE",
      ],
    );
    participants.push({
      id: participantId,
      displayName,
      participantToken: `ui-audit-participant-${suffix}-${index}`,
    });
  }

  const sessions: AuditSession[] = [];
  for (let index = 0; index < (input.sessionCount ?? 0); index += 1) {
    const session = await createUiAuditSession({
      facilitatorUserId: input.hostUserId,
      eventId,
      title: e2eName(`UI Audit Event Session ${index + 1}`),
      negotiatorCount: Math.min(8, Math.max(2, input.peopleCount - 1)),
      observerCount: Math.max(0, input.peopleCount - 3),
      language,
      lifecycle: index % 3 === 0 ? "RUNNING" : index % 3 === 1 ? "DEBRIEF_OPEN" : "CLOSED",
      longNames: input.longNames,
    });
    sessions.push(session);
  }

  return { id: eventId, title, hostToken, publicJoinCode, participants, sessions };
}

export async function createUiAuditSession(input: {
  facilitatorUserId: string;
  eventId?: string | null;
  title?: string;
  negotiatorCount: number;
  observerCount: number;
  language?: "RU" | "EN";
  lifecycle?: "OPEN" | "RUNNING" | "DEBRIEF_OPEN" | "CLOSED";
  cameraPattern?: "all-on" | "all-off" | "mixed";
  micPattern?: "all-on" | "all-off" | "mixed";
  longNames?: boolean;
}) {
  const lifecycle = input.lifecycle ?? "OPEN";
  const language = input.language ?? "RU";
  const negotiationCase = await createUiAuditCase({
    facilitatorUserId: input.facilitatorUserId,
    roleCount: Math.max(2, input.negotiatorCount),
    language,
    longContent: true,
  });
  const sessionId = e2eId("ui-audit-session");
  const status = lifecycle === "CLOSED" ? "COMPLETED" : "READY";
  const negotiationState =
    lifecycle === "RUNNING"
      ? "RUNNING"
      : lifecycle === "DEBRIEF_OPEN" || lifecycle === "CLOSED"
        ? "FINISHED"
        : "PREPARATION";
  const roomLifecycle = lifecycle === "RUNNING" ? "OPEN" : lifecycle;
  const negotiationStartedAt = negotiationState === "RUNNING" ? new Date() : null;
  const negotiationEndedAt = negotiationState === "FINISHED" ? new Date() : null;
  const title =
    input.title ??
    e2eName(
      language === "RU"
        ? "Длинная сессия переговоров с несколькими ролями и наблюдателями"
        : "Long Negotiation Session With Multiple Roles and Observers",
    );

  await query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "status", "negotiationState", "preparationDurationSeconds", "durationSeconds",
        "visibility", "eventId", "roomLabel", "roomLifecycle", "negotiationStartedAt",
        "negotiationEndedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'Audit snapshot business context',
        'Audit snapshot public instructions', $6, $7::"SessionStatus", $8::"NegotiationState",
        300, 900, 'PUBLIC', $9, $10, $11::"RoomLifecycle", $12, $13, NOW())`,
    [
      sessionId,
      negotiationCase.id,
      input.facilitatorUserId,
      title,
      negotiationCase.title,
      language,
      status,
      negotiationState,
      input.eventId ?? null,
      title,
      roomLifecycle,
      negotiationStartedAt,
      negotiationEndedAt,
    ],
  );

  const sessionRoles: AuditCaseRole[] = [];
  for (let index = 0; index < negotiationCase.roles.length; index += 1) {
    const sourceRole = negotiationCase.roles[index]!;
    const sessionRoleId = e2eId("ui-audit-session-role");
    await query(
      `INSERT INTO "SessionRole"
         ("id", "sessionId", "name", "privateInstructions", "objectives",
          "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        sessionRoleId,
        sessionId,
        sourceRole.name,
        `Private instructions for ${sourceRole.name}`,
        `Objectives for ${sourceRole.name}`,
        `Constraints for ${sourceRole.name}`,
        `Hidden information for ${sourceRole.name}`,
        `Fallback position for ${sourceRole.name}`,
        index,
      ],
    );
    sessionRoles.push({ id: sessionRoleId, name: sourceRole.name });
  }

  const participants: AuditSessionParticipant[] = [];
  const addParticipant = async (
    type: AuditSessionParticipant["type"],
    displayName: string,
    roleId: string | null,
    index: number,
  ) => {
    const participantId = e2eId("ui-audit-sp");
    const joinToken = `ui-audit-session-${getE2eRunId()}-${Math.random()
      .toString(36)
      .slice(2, 7)}-${index}`;
    await query(
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "userId", "sessionRoleId", "type", "joinToken",
          "displayName", "notes", "joinedAt", "lastSeenAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'UI audit notes', NOW(), NOW(), NOW())`,
      [
        participantId,
        sessionId,
        type === "FACILITATOR" ? input.facilitatorUserId : null,
        roleId,
        type,
        joinToken,
        displayName,
      ],
    );
    participants.push({ id: participantId, displayName, type, joinToken, roleId });
  };

  await addParticipant(
    "FACILITATOR",
    input.longNames ? "Facilitator With Long Display Name For Layout Audit" : "Audit Facilitator",
    null,
    0,
  );

  for (let index = 0; index < input.negotiatorCount; index += 1) {
    await addParticipant(
      "PARTICIPANT",
      input.longNames
        ? `Negotiator ${index + 1} With Very Long Legal Department Name`
        : `Negotiator ${index + 1}`,
      sessionRoles[index]?.id ?? null,
      index + 1,
    );
  }

  for (let index = 0; index < input.observerCount; index += 1) {
    await addParticipant(
      "OBSERVER",
      input.longNames
        ? `Observer ${index + 1} With Long Repeated Organization Name`
        : `Observer ${index + 1}`,
      null,
      index + 1 + input.negotiatorCount,
    );
  }

  await seedUiAuditMediaStatus({
    sessionId,
    participants,
    cameraPattern: input.cameraPattern ?? "mixed",
    micPattern: input.micPattern ?? "mixed",
  });

  if (lifecycle === "DEBRIEF_OPEN" || lifecycle === "CLOSED") {
    await seedUiAuditMaterials(sessionId, lifecycle === "CLOSED" ? "COMPLETED" : "PROCESSING");
  }

  return { id: sessionId, title, eventId: input.eventId ?? null, participants };
}

export async function seedUiAuditMediaStatus(input: {
  sessionId: string;
  participants: AuditSessionParticipant[];
  cameraPattern: "all-on" | "all-off" | "mixed";
  micPattern: "all-on" | "all-off" | "mixed";
}) {
  const participants = Object.fromEntries(
    input.participants.map((participant, index) => [
      participant.id,
      {
        connectionId: `ui-audit-${participant.id}`,
        micEnabled:
          input.micPattern === "all-on"
            ? true
            : input.micPattern === "all-off"
              ? false
              : index % 2 === 0,
        cameraEnabled:
          input.cameraPattern === "all-on"
            ? true
            : input.cameraPattern === "all-off"
              ? false
              : index % 3 !== 0,
        updatedAt: new Date().toISOString(),
      },
    ]),
  );

  await query(
    `INSERT INTO "AppSetting" ("key", "value", "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()`,
    [
      `voximplant:session-media-status:${input.sessionId}`,
      JSON.stringify({ version: 1, participants }),
    ],
  );
}

export async function seedUiAuditMaterials(
  sessionId: string,
  status: "PROCESSING" | "COMPLETED" | "FAILED",
) {
  const recordingId = e2eId("ui-audit-recording");
  await query(
    `INSERT INTO "Recording"
       ("id", "sessionId", "provider", "status", "recordingType", "fileName",
        "mimeType", "updatedAt", "endedAt")
     VALUES ($1, $2, 'UI_AUDIT', $3::"RecordingStatus", 'AUDIO_ONLY',
        'ui-audit-recording.mp4', 'audio/mp4', NOW(), NOW())
     ON CONFLICT ("sessionId") DO UPDATE
       SET "status" = EXCLUDED."status", "updatedAt" = NOW()`,
    [
      recordingId,
      sessionId,
      status === "FAILED" ? "FAILED" : status === "COMPLETED" ? "COMPLETED" : "PROCESSING",
    ],
  );

  await query(
    `INSERT INTO "Transcript"
       ("id", "sessionId", "recordingId", "source", "status", "text", "updatedAt", "completedAt")
     VALUES ($1, $2, $3, 'MANUAL', $4::"TranscriptStatus", 'UI audit transcript.',
       NOW(), CASE WHEN $4 = 'COMPLETED' THEN NOW() ELSE NULL END)
     ON CONFLICT ("sessionId") DO UPDATE
       SET "status" = EXCLUDED."status", "updatedAt" = NOW()`,
    [
      e2eId("ui-audit-transcript"),
      sessionId,
      recordingId,
      status === "FAILED" ? "FAILED" : status === "COMPLETED" ? "COMPLETED" : "TRANSCRIBING",
    ],
  );
}
