import { buildCanonicalDiarizedText } from "@/lib/transcription/canonical-diarized-text";
import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";
import {
  LARGE_REALISTIC_UAT_EMAIL_MARKER,
  LARGE_REALISTIC_UAT_FIXTURE_ID,
  LARGE_REALISTIC_UAT_SESSION_MARKER,
} from "./large-realistic-uat-constants";
import {
  LARGE_REALISTIC_FIXTURE_STATS,
  LARGE_REALISTIC_SEGMENTS,
  type LargeRealisticFixtureStats,
} from "./large-realistic-uat-fixture";
import {
  createActiveUser,
  createUserSessionCookie,
  e2eId,
  e2eName,
  query,
} from "./db";

export type LargeRealisticUatKind = "provider" | "manual" | "resume" | "recovery";

export type LargeRealisticUatSeededSession = {
  kind: LargeRealisticUatKind;
  fixtureId: string;
  sessionId: string;
  sessionTitle: string;
  transcriptId: string;
  recordingId: string;
  facilitator: {
    userId: string;
    email: string;
    participantId: string;
    joinToken: string;
    displayName: string;
    authCookie: string;
  };
  buyer: { userId: string; participantId: string; displayName: string };
  seller: { userId: string; participantId: string; displayName: string };
  stats: LargeRealisticFixtureStats;
};

function fixtureEmail(role: string): string {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${LARGE_REALISTIC_UAT_EMAIL_MARKER}.${role}.${unique}@test.negotaitions.local`;
}

export function buildPublishedRawText(): string {
  return LARGE_REALISTIC_SEGMENTS.map((segment) => segment.text).join(" ");
}

export async function seedLargeRealisticUatSession(
  kind: LargeRealisticUatKind,
): Promise<LargeRealisticUatSeededSession> {
  const stats = LARGE_REALISTIC_FIXTURE_STATS;
  const segments = LARGE_REALISTIC_SEGMENTS;
  const [facilitatorUser, buyerUser, sellerUser] = await Promise.all([
    createActiveUser({
      email: fixtureEmail("facilitator"),
      preferredLocale: "ru",
    }),
    createActiveUser({
      email: fixtureEmail("buyer"),
      preferredLocale: "ru",
    }),
    createActiveUser({
      email: fixtureEmail("seller"),
      preferredLocale: "ru",
    }),
  ]);

  await query(`UPDATE "User" SET "name" = $2, "role" = $3, "updatedAt" = NOW() WHERE "id" = $1`, [
    facilitatorUser.id,
    "Large UAT Facilitator",
    "FACILITATOR",
  ]);
  await query(`UPDATE "User" SET "name" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
    buyerUser.id,
    "Large UAT Buyer",
  ]);
  await query(`UPDATE "User" SET "name" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [
    sellerUser.id,
    "Large UAT Seller",
  ]);

  const caseId = e2eId("lru-case");
  const caseTitle = e2eName(`${LARGE_REALISTIC_UAT_SESSION_MARKER} synthetic B2B case`);
  await query(
    `INSERT INTO "NegotiationCase"
      ("id","title","description","businessContext","publicInstructions",
       "targetSkills","difficulty","caseLanguage",
       "defaultPreparationDurationSeconds","defaultDurationSeconds",
       "facilitatorId","createdByUserId","visibility","updatedAt")
     VALUES
      ($1,$2,'Synthetic large-realistic UAT case','Synthetic supplier-buyer commercial negotiation.',
       'Synthetic public instructions. No real customer data.',
       'commercial negotiation', 'MEDIUM', 'RU',
       300, 1800, $3, $3, 'PRIVATE', NOW())`,
    [caseId, caseTitle, facilitatorUser.id],
  );
  const roleRows = await query<{ id: string; name: string }>(
    `INSERT INTO "CaseRole"
      ("id","negotiationCaseId","name","privateInstructions","objectives",
       "constraints","hiddenInfo","fallbackPosition","sortOrder","updatedAt")
     VALUES
      ($1,$3,'Закупщик','Synthetic buyer private.','Hold price and quality.','Budget cap.','Hidden BATNA.', 'Walk away at 130.', 0, NOW()),
      ($2,$3,'Поставщик','Synthetic seller private.','Hold volume and cash.','Capacity.','Hidden floor.', 'Floor 115.', 1, NOW())
     RETURNING "id", "name"`,
    [e2eId("lru-role-buyer"), e2eId("lru-role-seller"), caseId],
  );
  const buyerRole = roleRows.find((row) => row.name === "Закупщик") ?? roleRows[0]!;
  const sellerRole = roleRows.find((row) => row.name === "Поставщик") ?? roleRows[1]!;

  const sessionId = e2eId(`lru-${kind}-session`);
  const sessionTitle = e2eName(
    `${LARGE_REALISTIC_UAT_SESSION_MARKER} ${kind} ${LARGE_REALISTIC_UAT_FIXTURE_ID}`,
  );
  const durationSeconds = Math.max(1800, Math.round(stats.estimatedDurationSeconds));
  await query(
    `INSERT INTO "Session"
      ("id","negotiationCaseId","facilitatorId","title",
       "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
       "snapshotCaseLanguage","status","negotiationState","roomLifecycle",
       "preparationDurationSeconds","durationSeconds","negotiationEndedAt","updatedAt")
     VALUES
      ($1,$2,$3,$4,$5,$6,$7,
       'RU','COMPLETED','FINISHED','DEBRIEF_OPEN',
       300,$8,NOW(),NOW())`,
    [
      sessionId,
      caseId,
      facilitatorUser.id,
      sessionTitle,
      caseTitle,
      "Synthetic supplier-buyer commercial negotiation. No real customer data.",
      "Synthetic public instructions.",
      durationSeconds,
    ],
  );

  const buyerSessionRoleId = e2eId("lru-buyer-srole");
  const sellerSessionRoleId = e2eId("lru-seller-srole");
  await query(
    `INSERT INTO "SessionRole"
      ("id","sessionId","name","privateInstructions","objectives",
       "constraints","hiddenInfo","fallbackPosition","sortOrder","updatedAt")
     VALUES
      ($1,$3,'Закупщик','Synthetic buyer private.','Hold price and quality.','Budget cap.','Hidden BATNA.','Walk away at 130.',0,NOW()),
      ($2,$3,'Поставщик','Synthetic seller private.','Hold volume and cash.','Capacity.','Hidden floor.','Floor 115.',1,NOW())`,
    [buyerSessionRoleId, sellerSessionRoleId, sessionId],
  );

  const facilitatorParticipantId = e2eId("lru-facilitator");
  const buyerParticipantId = e2eId("lru-buyer");
  const sellerParticipantId = e2eId("lru-seller");
  const facilitatorJoin = e2eId("lru-facilitator-join");
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","sessionRoleId","type","joinToken","displayName","notes","updatedAt")
     VALUES
      ($1,$4,$5,NULL,'FACILITATOR',$8,'Фасилитатор','Large realistic UAT facilitator',NOW()),
      ($2,$4,$6,$9,'PARTICIPANT',$10,'Закупщик','BUYER',NOW()),
      ($3,$4,$7,$11,'PARTICIPANT',$12,'Поставщик','SELLER',NOW())`,
    [
      facilitatorParticipantId,
      buyerParticipantId,
      sellerParticipantId,
      sessionId,
      facilitatorUser.id,
      buyerUser.id,
      sellerUser.id,
      facilitatorJoin,
      buyerSessionRoleId,
      e2eId("lru-buyer-join"),
      sellerSessionRoleId,
      e2eId("lru-seller-join"),
    ],
  );

  const recordingId = e2eId("lru-recording");
  const recordingSeconds = Math.round(stats.estimatedDurationSeconds);
  await query(
    `INSERT INTO "Recording"
      ("id","sessionId","provider","status","recordingType","fileKey","fileName",
       "mimeType","startedAt","endedAt","updatedAt")
     VALUES ($1,$2,'E2E','COMPLETED','AUDIO_ONLY',$3,'large-realistic-uat.mp4',
       'audio/mp4', NOW() - ($4 * INTERVAL '1 second'), NOW() - INTERVAL '90 seconds', NOW())`,
    [recordingId, sessionId, `recordings/${sessionId}/large-realistic-uat.mp4`, recordingSeconds],
  );

  const speakerMapping: SpeakerMapping = {
    speaker_0: buyerParticipantId,
    speaker_1: sellerParticipantId,
  };
  const rawText = buildPublishedRawText();
  const diarizedText = buildCanonicalDiarizedText({
    segments: segments.map((segment) => ({
      speakerLabel: segment.speakerLabel,
      displaySpeakerLabel: null,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segment.text,
      orderIndex: segment.orderIndex,
    })),
    speakerMapping,
    participants: [
      {
        id: buyerParticipantId,
        displayName: "Закупщик",
        type: "PARTICIPANT",
        roleName: buyerRole.name,
      },
      {
        id: sellerParticipantId,
        displayName: "Поставщик",
        type: "PARTICIPANT",
        roleName: sellerRole.name,
      },
    ],
  });

  const processingMetadata = {
    transcriptionProvider: "yandex_speechkit",
    transcriptionModel: "speechkit",
    pauseProcessing: { mode: "source_audio_cut" },
    largeRealisticUat: {
      fixtureId: LARGE_REALISTIC_UAT_FIXTURE_ID,
      synthetic: true,
      kind,
      createdAt: new Date().toISOString(),
    },
    transcriptEnhancementRecommendation: {
      available: true,
      suggested: true,
      reasons: ["asr_artifacts:punctuation,agreement,fillers"],
      asrArtifactsDetected: true,
    },
    mappingSuggestion: {
      source: "fixture",
      isApplied: true,
      reason: "auto_suggested",
      candidateMapping: speakerMapping,
    },
  };

  const transcriptId = e2eId("lru-transcript");
  await query(
    `INSERT INTO "Transcript"
      ("id","sessionId","recordingId","source","status","text","diarizedText","language",
       "hasSpeakerDiarization","speakerMapping","speakerMappingStatus",
       "diarizationStatus","retranscribeCount","processingMetadata",
       "completedAt","updatedAt")
     VALUES
      ($1,$2,$3,'GENERATED','COMPLETED',$4,$5,'ru',
       TRUE,$6::jsonb,'AUTO_SUGGESTED',
       'COMPLETED',0,$7::jsonb,
       NOW(),NOW())`,
    [
      transcriptId,
      sessionId,
      recordingId,
      rawText,
      diarizedText,
      JSON.stringify(speakerMapping),
      JSON.stringify(processingMetadata),
    ],
  );

  for (const segment of segments) {
    await query(
      `INSERT INTO "TranscriptSegment"
        ("id","transcriptId","speakerLabel","mappedParticipantId","startSeconds",
         "endSeconds","text","qualityText","orderIndex","mappingSource","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CLUSTER_MAPPING',NOW())`,
      [
        e2eId(`lru-seg-${segment.orderIndex}`),
        transcriptId,
        segment.speakerLabel,
        segment.speakerLabel === "speaker_0" ? buyerParticipantId : sellerParticipantId,
        segment.startSeconds,
        segment.endSeconds,
        segment.text,
        segment.text,
        segment.orderIndex,
      ],
    );
  }

  return {
    kind,
    fixtureId: LARGE_REALISTIC_UAT_FIXTURE_ID,
    sessionId,
    sessionTitle,
    transcriptId,
    recordingId,
    facilitator: {
      userId: facilitatorUser.id,
      email: facilitatorUser.email,
      participantId: facilitatorParticipantId,
      joinToken: facilitatorJoin,
      displayName: "Фасилитатор",
      authCookie: await createUserSessionCookie(facilitatorUser.id),
    },
    buyer: {
      userId: buyerUser.id,
      participantId: buyerParticipantId,
      displayName: "Закупщик",
    },
    seller: {
      userId: sellerUser.id,
      participantId: sellerParticipantId,
      displayName: "Поставщик",
    },
    stats,
  };
}

export async function listLargeRealisticUatSessions(): Promise<
  Array<{
    sessionId: string;
    title: string;
    transcriptId: string | null;
    createdAt: string;
    kind: string | null;
  }>
> {
  return query(
    `SELECT s."id" AS "sessionId", s."title", t."id" AS "transcriptId",
            s."createdAt"::text AS "createdAt",
            t."processingMetadata"#>>'{largeRealisticUat,kind}' AS kind
       FROM "Session" s
       LEFT JOIN "Transcript" t ON t."sessionId" = s."id"
      WHERE s."title" LIKE $1
         OR COALESCE(t."processingMetadata"#>>'{largeRealisticUat,fixtureId}', '') = $2
      ORDER BY s."createdAt" DESC`,
    [`%${LARGE_REALISTIC_UAT_SESSION_MARKER}%`, LARGE_REALISTIC_UAT_FIXTURE_ID],
  );
}

export async function deleteLargeRealisticUatSessions(): Promise<{
  sessionsDeleted: number;
  usersDeleted: number;
}> {
  const sessions = await listLargeRealisticUatSessions();
  const sessionIds = sessions.map((row) => row.sessionId);
  if (sessionIds.length > 0) {
    const cases = await query<{ negotiationCaseId: string }>(
      `SELECT DISTINCT "negotiationCaseId" FROM "Session" WHERE "id" = ANY($1)`,
      [sessionIds],
    );
    await query(`DELETE FROM "Session" WHERE "id" = ANY($1)`, [sessionIds]);
    const caseIds = cases.map((row) => row.negotiationCaseId);
    if (caseIds.length > 0) {
      await query(
        `DELETE FROM "NegotiationCase" n
          WHERE n."id" = ANY($1)
            AND NOT EXISTS (SELECT 1 FROM "Session" s WHERE s."negotiationCaseId" = n."id")`,
        [caseIds],
      );
    }
  }
  const users = await query<{ id: string }>(
    `SELECT "id" FROM "User" WHERE "email" LIKE $1`,
    [`${LARGE_REALISTIC_UAT_EMAIL_MARKER}.%@test.negotaitions.local`],
  );
  const userIds = users.map((row) => row.id);
  if (userIds.length > 0) {
    await query(`DELETE FROM "EmailMessage" WHERE "userId" = ANY($1)`, [userIds]);
    await query(`DELETE FROM "User" WHERE "id" = ANY($1)`, [userIds]);
  }
  return { sessionsDeleted: sessionIds.length, usersDeleted: userIds.length };
}
