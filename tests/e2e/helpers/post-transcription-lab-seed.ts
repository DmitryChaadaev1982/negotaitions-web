import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  createUserSessionCookie,
  e2eId,
  e2eName,
  query,
} from "./db";
import { buildLabCanonicalAnalysisJson } from "./post-transcription-lab-analysis";
import {
  getLabScenario,
  type LabAiFixture,
  type LabEnhancementFixture,
  type LabMappingFixture,
  type PostTranscriptionLabScenarioDefinition,
  type PostTranscriptionLabScenarioId,
} from "./post-transcription-lab-catalog";
import { assertPostTranscriptionLabSafety } from "./post-transcription-lab-safety";
import { buildCanonicalDiarizedText } from "@/lib/transcription/canonical-diarized-text";
import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";
import {
  applyLabCompletedEnhancementToTurns,
  formatLabVisualDiarizedText,
  formatLabVisualTranscriptText,
  LAB_VISUAL_TWO_PARTY_TRANSCRIPT,
} from "./post-transcription-lab-transcript";

export type LabSeededActor = {
  userId: string;
  email: string;
  participantId: string;
  joinToken: string;
  displayName: string;
  type: "FACILITATOR" | "PARTICIPANT" | "OBSERVER";
  notes: string;
};

export type LabSeededScenario = {
  definition: PostTranscriptionLabScenarioDefinition;
  sessionId: string;
  sessionTitle: string;
  transcriptId: string;
  recordingId: string;
  facilitator: LabSeededActor;
  buyer: LabSeededActor;
  seller: LabSeededActor;
  observer: LabSeededActor;
  facilitatorAuthCookie: string;
};

function enhancementMetadata(status: LabEnhancementFixture): Record<string, unknown> {
  if (status === "none") {
    return {
      mappingSuggestion: { source: "fixture", isApplied: false },
    };
  }
  return {
    transcriptionProvider: "yandex_speechkit",
    transcriptEnhancement: {
      status,
      source: "post-transcription-lab",
      startedAt: status === "RUNNING"
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : new Date().toISOString(),
    },
    mappingSuggestion: {
      source: "fixture",
      isApplied: status !== "RUNNING",
    },
  };
}

function mappingStatus(mapping: LabMappingFixture): string {
  if (mapping === "AUTO_SUGGESTED_COMPLETE" || mapping === "AUTO_SUGGESTED_INCOMPLETE") {
    return "AUTO_SUGGESTED";
  }
  return mapping;
}

async function insertUser(label: string, locale: "ru" | "en" = "ru") {
  return createActiveUser({
    email: undefined,
    preferredLocale: locale,
  }).then(async (user) => {
    await query(
      `UPDATE "User" SET "name" = $2, "role" = $3, "updatedAt" = NOW() WHERE "id" = $1`,
      [
        user.id,
        label,
        label.includes("Facilitator") ? "FACILITATOR" : "PARTICIPANT",
      ],
    );
    return user;
  });
}

export async function seedPostTranscriptionLabScenario(
  scenarioId: PostTranscriptionLabScenarioId | string,
): Promise<LabSeededScenario> {
  assertPostTranscriptionLabSafety();
  const definition = getLabScenario(scenarioId);
  await cleanupE2eData();

  const [facilitatorUser, buyerUser, sellerUser, observerUser] = await Promise.all([
    insertUser("Lab Facilitator", "ru"),
    insertUser("Lab Buyer", "ru"),
    insertUser("Lab Seller", "ru"),
    insertUser("Lab Observer", "ru"),
  ]);
  const negotiationCase = await createE2eCase();
  const buyerRole = negotiationCase.roles[0]!;
  const sellerRole = negotiationCase.roles[1]!;

  const sessionId = e2eId(`lab-${definition.id.toLowerCase()}-session`);
  const sessionTitle = e2eName(`Lab ${definition.id} ${definition.title}`);
  await query(
    `INSERT INTO "Session"
      ("id","negotiationCaseId","facilitatorId","title",
       "snapshotCaseTitle","snapshotBusinessContext","snapshotPublicInstructions",
       "snapshotCaseLanguage","status","negotiationState","roomLifecycle",
       "preparationDurationSeconds","durationSeconds","negotiationEndedAt","updatedAt")
     VALUES
      ($1,$2,$3,$4,$5,'Lab public business context','Lab public instructions',
       'RU','COMPLETED','FINISHED','DEBRIEF_OPEN',300,900,NOW(),NOW())`,
    [
      sessionId,
      negotiationCase.id,
      facilitatorUser.id,
      sessionTitle,
      negotiationCase.title,
    ],
  );

  const buyerSessionRoleId = e2eId("lab-buyer-role");
  const sellerSessionRoleId = e2eId("lab-seller-role");
  await query(
    `INSERT INTO "SessionRole"
      ("id","sessionId","name","privateInstructions","objectives",
       "constraints","hiddenInfo","fallbackPosition","sortOrder","updatedAt")
     VALUES
      ($1,$3,$4,$5,$6,$7,$8,$9,0,NOW()),
      ($2,$3,$10,$11,$12,$13,$14,$15,1,NOW())`,
    [
      buyerSessionRoleId,
      sellerSessionRoleId,
      sessionId,
      buyerRole.name,
      buyerRole.privateInstructions,
      buyerRole.objectives,
      buyerRole.constraints,
      buyerRole.hiddenInfo,
      buyerRole.fallbackPosition,
      sellerRole.name,
      sellerRole.privateInstructions,
      sellerRole.objectives,
      sellerRole.constraints,
      sellerRole.hiddenInfo,
      sellerRole.fallbackPosition,
    ],
  );

  const facilitator = await insertParticipant({
    sessionId,
    userId: facilitatorUser.id,
    email: facilitatorUser.email,
    type: "FACILITATOR",
    displayName: "Lab Facilitator",
    notes: "Facilitator debrief note A",
    sessionRoleId: null,
  });
  const buyer = await insertParticipant({
    sessionId,
    userId: buyerUser.id,
    email: buyerUser.email,
    type: "PARTICIPANT",
    displayName: "Lab Buyer",
    notes: "Buyer preparation: target 120",
    sessionRoleId: buyerSessionRoleId,
  });
  const seller = await insertParticipant({
    sessionId,
    userId: sellerUser.id,
    email: sellerUser.email,
    type: "PARTICIPANT",
    displayName: "Lab Seller",
    notes: "Seller preparation: floor 140",
    sessionRoleId: sellerSessionRoleId,
  });
  const observer = await insertParticipant({
    sessionId,
    userId: observerUser.id,
    email: observerUser.email,
    type: "OBSERVER",
    displayName: "Lab Observer",
    notes: "Observer note A",
    sessionRoleId: null,
  });

  const recordingId = e2eId("lab-recording");
  await query(
    `INSERT INTO "Recording"
      ("id","sessionId","provider","status","recordingType","fileKey","fileName",
       "mimeType","startedAt","endedAt","updatedAt")
     VALUES ($1,$2,'E2E','COMPLETED','AUDIO_ONLY',$3,'lab-audio.mp4',
       'audio/mp4', NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '5 minutes', NOW())`,
    [recordingId, sessionId, `recordings/${sessionId}/lab-audio.mp4`],
  );

  const transcriptId = e2eId("lab-transcript");
  const mapping = definition.mapping;
  const isTerminalEnhancementVisual = definition.id === "E05";
  const sourceTurns = LAB_VISUAL_TWO_PARTY_TRANSCRIPT;
  const turns = isTerminalEnhancementVisual
    ? applyLabCompletedEnhancementToTurns(sourceTurns)
    : sourceTurns;
  const speakerMappingJson: SpeakerMapping =
    mapping === "REQUIRED" || mapping === "NEEDS_REVIEW"
      ? {}
      : {
          speaker_0: buyer.participantId,
          speaker_1: mapping === "AUTO_SUGGESTED_INCOMPLETE" ? null : seller.participantId,
        };
  const mappedNames = {
    speaker_0:
      mapping === "REQUIRED" || mapping === "NEEDS_REVIEW" ? "speaker_0" : buyer.displayName,
    speaker_1:
      mapping === "AUTO_SUGGESTED_COMPLETE" || mapping === "CONFIRMED"
        ? seller.displayName
        : "speaker_1",
  };

  const diarizedText = isTerminalEnhancementVisual
    ? buildCanonicalDiarizedText({
        segments: turns.map((turn, orderIndex) => ({
          speakerLabel: turn.speakerLabel,
          displaySpeakerLabel: null,
          startSeconds: turn.startSeconds,
          endSeconds: turn.endSeconds,
          text: turn.text,
          orderIndex,
        })),
        speakerMapping: speakerMappingJson,
        participants: [
          {
            id: buyer.participantId,
            displayName: buyer.displayName,
            type: "PARTICIPANT",
            roleName: buyerRole.name,
          },
          {
            id: seller.participantId,
            displayName: seller.displayName,
            type: "PARTICIPANT",
            roleName: sellerRole.name,
          },
        ],
      })
    : formatLabVisualDiarizedText(turns, mappedNames);

  await query(
    `INSERT INTO "Transcript"
      ("id","sessionId","recordingId","source","status","text","diarizedText",
       "hasSpeakerDiarization","speakerMapping","speakerMappingStatus",
       "speakerMappingConfirmedAt","speakerMappingConfirmedBy",
       "diarizationStatus","retranscribeCount","processingMetadata",
       "completedAt","updatedAt")
     VALUES
      ($1,$2,$3,'GENERATED','COMPLETED',$4,$5,
       TRUE,$6::jsonb,$7,
       $8,$9,
       'COMPLETED',$10,$11::jsonb,
       NOW(),NOW())`,
    [
      transcriptId,
      sessionId,
      recordingId,
      formatLabVisualTranscriptText(turns),
      diarizedText,
      JSON.stringify(speakerMappingJson),
      mappingStatus(mapping),
      mapping === "CONFIRMED" ? new Date() : null,
      mapping === "CONFIRMED" ? facilitator.userId : null,
      definition.id === "F05" ? 1 : 0,
      JSON.stringify(enhancementMetadata(definition.enhancement)),
    ],
  );

  const mapBuyer =
    mapping !== "REQUIRED" && mapping !== "NEEDS_REVIEW" ? buyer.participantId : null;
  const mapSeller =
    mapping === "AUTO_SUGGESTED_COMPLETE" || mapping === "CONFIRMED"
      ? seller.participantId
      : null;
  const mappingSource =
    mapping === "CONFIRMED" ? "MANUAL_CLUSTER_MAPPING" : "CLUSTER_MAPPING";

  for (const [index, turn] of turns.entries()) {
    await query(
      `INSERT INTO "TranscriptSegment"
        ("id","transcriptId","speakerLabel","mappedParticipantId","startSeconds",
         "endSeconds","text","qualityText","orderIndex","mappingSource","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
      [
        e2eId(`lab-seg-${index}`),
        transcriptId,
        turn.speakerLabel,
        turn.speakerLabel === "speaker_0" ? mapBuyer : mapSeller,
        turn.startSeconds,
        turn.endSeconds,
        turn.text,
        sourceTurns[index]?.text ?? turn.text,
        index,
        mappingSource,
      ],
    );
  }

  await insertAiFixture({
    definition,
    sessionId,
    transcriptId,
    facilitator,
    buyer,
    seller,
    observer,
  });

  if (
    (definition.ai === "COMPLETED" || definition.ai === "PUBLISHED") &&
    definition.id !== "I05"
  ) {
    await runLabTsxScript("scripts/lab-stamp-input-fingerprint.ts", [
      sessionId,
      definition.id === "I04" ? "mismatch" : "match",
    ]);
  }

  return {
    definition,
    sessionId,
    sessionTitle,
    transcriptId,
    recordingId,
    facilitator,
    buyer,
    seller,
    observer,
    facilitatorAuthCookie: await createUserSessionCookie(facilitator.userId),
  };
}

async function insertParticipant(input: {
  sessionId: string;
  userId: string;
  email: string;
  type: LabSeededActor["type"];
  displayName: string;
  notes: string;
  sessionRoleId: string | null;
}): Promise<LabSeededActor> {
  const participantId = e2eId(`lab-${input.type.toLowerCase()}`);
  const joinToken = e2eId(`lab-${input.type.toLowerCase()}-join`);
  await query(
    `INSERT INTO "SessionParticipant"
      ("id","sessionId","userId","sessionRoleId","type","joinToken","displayName","notes","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [
      participantId,
      input.sessionId,
      input.userId,
      input.sessionRoleId,
      input.type,
      joinToken,
      input.displayName,
      input.notes,
    ],
  );
  return {
    userId: input.userId,
    email: input.email,
    participantId,
    joinToken,
    displayName: input.displayName,
    type: input.type,
    notes: input.notes,
  };
}

async function insertAiFixture(input: {
  definition: PostTranscriptionLabScenarioDefinition;
  sessionId: string;
  transcriptId: string;
  facilitator: LabSeededActor;
  buyer: LabSeededActor;
  seller: LabSeededActor;
  observer: LabSeededActor;
}) {
  const ai = input.definition.ai as LabAiFixture;
  if (ai === "none") {
    return;
  }

  const analysisId = e2eId("lab-ai");
  const analysisJson = buildLabCanonicalAnalysisJson({
    scenarioId: input.definition.id,
    buyer: input.buyer,
    seller: input.seller,
    facilitator: input.facilitator,
    observer: input.observer,
  });
  const status =
    ai === "QUEUED" ? "QUEUED" : ai === "ANALYZING" ? "ANALYZING" : "COMPLETED";
  const visibility = ai === "PUBLISHED" ? "SHARED_WITH_SESSION" : "FACILITATOR_ONLY";
  const runToken = ai === "ANALYZING" || ai === "QUEUED" ? e2eId("lab-run") : null;
  const transcriptRetranscribeCount = input.definition.id === "F05" ? 1 : 0;

  await query(
    `INSERT INTO "AiAnalysis"
      ("id","sessionId","transcriptId","transcriptRetranscribeCount","analysisVersion",
       "publicationEpoch","status","runToken","leaseExpiresAt","model","language",
       "executiveSummary","overallScore","analysisJson","visibility",
       "startedAt","completedAt","updatedAt")
     VALUES
      ($1,$2,$3,$4,1,
       $5,$6,$7,$8,'lab-mock','ru',
       $9,$10,$11::jsonb,$12,
       NOW() - INTERVAL '2 minutes',$13,NOW())`,
    [
      analysisId,
      input.sessionId,
      input.transcriptId,
      transcriptRetranscribeCount,
      ai === "PUBLISHED" ? 1 : 0,
      status,
      runToken,
      ai === "ANALYZING" || ai === "QUEUED"
        ? new Date(Date.now() + 10 * 60 * 1000)
        : null,
      analysisJson.executiveSummary,
      analysisJson.overallScore,
      JSON.stringify(analysisJson),
      visibility,
      status === "COMPLETED" ? new Date() : null,
    ],
  );

  if (ai !== "PUBLISHED") {
    return;
  }

  const publicationId = e2eId("lab-pub");
  await query(
    `INSERT INTO "AiAnalysisPublication"
      ("id","aiAnalysisId","analysisVersion","publicationEpoch","sharedAnalysisJson",
       "sharedExecutiveSummary","publishedAt","publishedBy","createdAt","updatedAt")
     VALUES ($1,$2,1,1,$3::jsonb,$4,NOW(),$5,NOW(),NOW())`,
    [
      publicationId,
      analysisId,
      JSON.stringify(analysisJson),
      analysisJson.executiveSummary,
      input.facilitator.userId,
    ],
  );

  for (const [actor, projection] of [
    [input.buyer, "PARTICIPANT"],
    [input.seller, "PARTICIPANT"],
    [input.observer, "OBSERVER"],
  ] as const) {
    await query(
      `INSERT INTO "AiAnalysisPublicationGrant"
        ("id","publicationId","sessionParticipantId","userId","projection",
         "grantedAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW(),NOW())`,
      [e2eId("lab-grant"), publicationId, actor.participantId, actor.userId, projection],
    );
  }
}

async function runLabTsxScript(relativeScriptPath: string, args: string[]) {
  const e2eUrl = process.env.E2E_DATABASE_URL?.trim();
  if (!e2eUrl) {
    throw new Error("Lab tsx helper requires E2E_DATABASE_URL");
  }
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const scriptPath = path.join(process.cwd(), relativeScriptPath);
  const { stdout, stderr, code } = await new Promise<{
    stdout: string;
    stderr: string;
    code: number;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", scriptPath, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: e2eUrl,
        E2E_DATABASE_URL: e2eUrl,
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, code: exitCode ?? 1 });
    });
  });
  if (code !== 0) {
    throw new Error(
      `${relativeScriptPath} failed (${code}): ${stderr || stdout}`,
    );
  }
}
