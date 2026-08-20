import {
  AUTO_MAPPING_HIGH_CONFIDENCE,
  AUTO_MAPPING_MIN_MARGIN,
} from "../../../lib/transcription/auto-trigger-mapping-core";
import { decideAutoMappingApplication } from "../../../lib/transcription/mapping-decision";
import { evaluateMappingSafety } from "../../../lib/transcription/mapping-safety";
import { evaluateSpeakerMappingStructuralCompleteness } from "../../../lib/transcription/speaker-mapping-completeness";
import {
  cleanupE2eData,
  createActiveUser,
  createAudioActivity,
  createE2eCase,
  createRoomConnectionForParticipant,
  createUserSessionCookie,
  e2eId,
  e2eName,
  query,
} from "./db";
import {
  getLabScenario,
  type PostTranscriptionLabScenarioId,
} from "./post-transcription-lab-catalog";
import { assertPostTranscriptionLabSafety } from "./post-transcription-lab-safety";
import type { LabSeededActor, LabSeededScenario } from "./post-transcription-lab-seed";

type ActivityWindow = {
  actor: "buyer" | "seller" | "broker";
  startSeconds: number;
  endSeconds: number;
};

type SegmentInput = {
  speakerLabel: string | null;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type PipelineExpected = {
  applied: boolean;
  statusIn: string[];
  selectedSourceIn: Array<
    "VOX_REMOTE_STREAM_ACTIVITY" | "VOXIMPLANT_MIC_ACTIVITY" | "NONE"
  >;
  assignment?: Record<string, "buyer" | "seller" | "broker">;
  overrideReached?: boolean;
  confirmedNull: boolean;
  notes: string;
};

export type PipelineActual = {
  speakerMappingStatus: string | null;
  speakerMapping: Record<string, string | null>;
  segmentAssignments: Array<{
    speakerLabel: string | null;
    mappedParticipantId: string | null;
    mappingSource: string | null;
    mappingConfidence: number | null;
  }>;
  confirmedAt: string | null;
  confirmedBy: string | null;
  selectedSource: string | null;
  isApplied: boolean | null;
  reason: string | null;
  weakMarginDetected: boolean | null;
  weakMarginOverriddenByGlobalEvidence: boolean | null;
  globalAssignmentMargin: number | null;
  minConfidence: number | null;
  candidateParticipantIds: string[];
  presentUserIds: string[];
  structuralComplete: boolean;
  aiReadyByCurrentContract: boolean;
};

export type PipelineRunResult = {
  seeded: LabSeededScenario & { broker?: LabSeededActor; invitedWithoutPresence?: LabSeededActor };
  expected: PipelineExpected;
  actual: PipelineActual;
  pass: boolean;
  failures: string[];
  beforeReport: string;
  afterReport: string;
};

const REMOTE = "VOX_REMOTE_STREAM_ACTIVITY";
const LOCAL = "VOXIMPLANT_MIC_ACTIVITY";
const LIVEKIT = "LIVEKIT_ACTIVE_SPEAKER";

async function insertUser(label: string) {
  const user = await createActiveUser({ preferredLocale: "ru" });
  await query(
    `UPDATE "User" SET "name" = $2, "role" = $3, "updatedAt" = NOW() WHERE "id" = $1`,
    [user.id, label, label.includes("Facilitator") ? "FACILITATOR" : "PARTICIPANT"],
  );
  return user;
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

function actorId(
  seeded: PipelineRunResult["seeded"],
  key: "buyer" | "seller" | "broker",
): string {
  if (key === "broker") {
    if (!seeded.broker) {
      throw new Error("Pipeline fixture referenced broker without seeding one");
    }
    return seeded.broker.participantId;
  }
  return seeded[key].participantId;
}

function expectedAssignmentIds(
  seeded: PipelineRunResult["seeded"],
  assignment: Record<string, "buyer" | "seller" | "broker"> | undefined,
): Record<string, string> | null {
  if (!assignment) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(assignment).map(([label, key]) => [label, actorId(seeded, key)]),
  );
}

export function pipelineExpectation(id: PostTranscriptionLabScenarioId): PipelineExpected {
  switch (id) {
    case "AM01":
      return {
        applied: true,
        statusIn: ["AUTO_SUGGESTED"],
        selectedSourceIn: [REMOTE],
        assignment: { speaker_0: "buyer", speaker_1: "seller" },
        confirmedNull: true,
        notes: "Strong remote 2x2 must auto-apply and must not persist CONFIRMED.",
      };
    case "AM02":
      return {
        applied: true,
        statusIn: ["AUTO_SUGGESTED"],
        selectedSourceIn: [LOCAL],
        assignment: { speaker_0: "buyer", speaker_1: "seller" },
        confirmedNull: true,
        notes: "Local mic fallback of the real solver, not /transcribe-recording.",
      };
    case "AM03":
      return {
        applied: false,
        statusIn: ["REQUIRED", "NEEDS_REVIEW"],
        selectedSourceIn: ["NONE", REMOTE, LOCAL],
        confirmedNull: true,
        notes: "Ambiguous overlapping telemetry must not auto-apply.",
      };
    case "AM04":
      return {
        applied: false,
        statusIn: ["REQUIRED", "NEEDS_REVIEW"],
        selectedSourceIn: ["NONE", REMOTE, LOCAL],
        confirmedNull: true,
        notes:
          "Many-to-one/collapsed mapping must not be applied. Current production rejects this at source selection (no_reliable_telemetry_source) because a usable source must already be 1:1.",
      };
    case "AM04B":
      return {
        applied: false,
        statusIn: ["REQUIRED", "NEEDS_REVIEW"],
        selectedSourceIn: ["NONE", REMOTE, LOCAL],
        confirmedNull: true,
        notes:
          "Same collapsed input as AM04, plus decision-core proof that a constructed many-to-one mapping cannot auto-apply.",
      };
    case "AM05":
      return {
        applied: false,
        statusIn: ["REQUIRED", "NEEDS_REVIEW"],
        selectedSourceIn: ["NONE", REMOTE, LOCAL],
        confirmedNull: true,
        notes: "One unresolved speaker remains structurally incomplete.",
      };
    case "AM06":
      return {
        applied: true,
        statusIn: ["AUTO_SUGGESTED"],
        selectedSourceIn: [REMOTE],
        assignment: {
          speaker_0: "buyer",
          speaker_1: "seller",
          speaker_2: "broker",
        },
        confirmedNull: true,
        notes: "Real global assignment across three speakers.",
      };
    case "AM07":
    case "AM07A":
    case "AM07E":
      return {
        applied: true,
        statusIn: ["AUTO_SUGGESTED"],
        selectedSourceIn: [REMOTE],
        assignment: { speaker_0: "buyer", speaker_1: "seller" },
        confirmedNull: true,
        notes:
          "Invitee who never entered is excluded. A/B presence-filtered 2x2 must AUTO_SUGGESTED.",
      };
    case "AM07B":
      return {
        applied: true,
        statusIn: ["AUTO_SUGGESTED"],
        selectedSourceIn: [REMOTE],
        assignment: { speaker_0: "buyer", speaker_1: "seller" },
        confirmedNull: true,
        notes: "Entered-then-disconnected seller remains a historical-presence candidate.",
      };
    case "AM07C":
      return {
        applied: false,
        statusIn: ["REQUIRED", "NEEDS_REVIEW"],
        selectedSourceIn: ["NONE", REMOTE, LOCAL],
        confirmedNull: true,
        notes: "Seller never entered, so seller is not a speaker-mapping candidate.",
      };
    case "AM07D":
      return {
        applied: true,
        statusIn: ["AUTO_SUGGESTED"],
        selectedSourceIn: [REMOTE],
        assignment: { speaker_0: "buyer", speaker_1: "seller" },
        confirmedNull: true,
        notes: "Facilitator/observer presence must not enter the negotiation candidate set.",
      };
    case "AM08":
      return {
        applied: false,
        statusIn: ["REQUIRED", "NEEDS_REVIEW"],
        selectedSourceIn: ["NONE"],
        confirmedNull: true,
        notes: "Disagreeing usable sources without a clear winner stay review.",
      };
    case "AM09":
      return {
        applied: false,
        statusIn: ["REQUIRED", "NEEDS_REVIEW"],
        selectedSourceIn: ["NONE", REMOTE, LOCAL],
        confirmedNull: true,
        notes: "Single-speaker diarization must not invent a second assignment.",
      };
    case "AM10":
      return {
        applied: false,
        statusIn: ["REQUIRED", "NOT_REQUIRED"],
        selectedSourceIn: ["NONE"],
        confirmedNull: true,
        notes: "No diarization: algorithm must not fabricate mapping.",
      };
    case "AM11":
      return {
        applied: true,
        statusIn: ["AUTO_SUGGESTED"],
        selectedSourceIn: [REMOTE],
        assignment: { speaker_0: "buyer", speaker_1: "seller" },
        overrideReached: true,
        confirmedNull: true,
        notes: "2x2 global-margin override must be reached and may auto-apply.",
      };
    case "AM12":
      return {
        applied: false,
        statusIn: ["REQUIRED", "NEEDS_REVIEW"],
        selectedSourceIn: ["NONE", REMOTE, LOCAL],
        confirmedNull: true,
        notes: `Below AUTO_MAPPING_HIGH_CONFIDENCE=${AUTO_MAPPING_HIGH_CONFIDENCE} must not auto-apply.`,
      };
    case "AM13":
      return {
        applied: true,
        statusIn: ["AUTO_SUGGESTED"],
        selectedSourceIn: [REMOTE],
        assignment: { speaker_0: "buyer", speaker_1: "seller" },
        confirmedNull: true,
        notes: `Above AUTO_MAPPING_MIN_MARGIN=${AUTO_MAPPING_MIN_MARGIN} with high confidence may auto-apply.`,
      };
    case "AM14":
      return {
        applied: false,
        statusIn: ["REQUIRED", "NEEDS_REVIEW"],
        selectedSourceIn: ["NONE"],
        confirmedNull: true,
        notes:
          "LIVEKIT_ACTIVE_SPEAKER is insertable but not scored by the current remote/local reader.",
      };
    default:
      throw new Error(`${id} is not a pipeline fixture`);
  }
}

function pipelineSpec(id: PostTranscriptionLabScenarioId): {
  participantCount: 2 | 3;
  extraInvitee: boolean;
  hasDiarization: boolean;
  diarizationStatus: string;
  segments: SegmentInput[];
  remote: ActivityWindow[];
  local: ActivityWindow[];
  livekit: ActivityWindow[];
  presence: Array<"buyer" | "seller" | "broker">;
  staffPresence?: Array<"facilitator" | "observer">;
  disconnected?: Array<"buyer" | "seller" | "broker">;
} {
  const twoSpeakerDialogue: SegmentInput[] = [
    {
      speakerLabel: "speaker_0",
      startSeconds: 0,
      endSeconds: 5,
      text: "Мы готовы обсуждать условия поставки.",
    },
    {
      speakerLabel: "speaker_1",
      startSeconds: 5.3,
      endSeconds: 11,
      text: "Для нас главным вопросом являются сроки.",
    },
    {
      speakerLabel: "speaker_0",
      startSeconds: 11.4,
      endSeconds: 16,
      text: "Тогда давайте начнем с графика.",
    },
  ];
  const strongRemote: ActivityWindow[] = [
    { actor: "buyer", startSeconds: 0, endSeconds: 5 },
    { actor: "buyer", startSeconds: 11.4, endSeconds: 16 },
    { actor: "seller", startSeconds: 5.3, endSeconds: 8.1 },
    { actor: "seller", startSeconds: 8.2, endSeconds: 11 },
  ];

  switch (id) {
    case "AM01":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: strongRemote,
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM12":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: [
          {
            speakerLabel: "speaker_0",
            startSeconds: 0,
            endSeconds: 10,
            text: "Мы готовы обсуждать условия поставки достаточно подробно.",
          },
          {
            speakerLabel: "speaker_1",
            startSeconds: 10.2,
            endSeconds: 20,
            text: "Для нас главным вопросом остаются сроки и объем.",
          },
        ],
        remote: [
          { actor: "buyer", startSeconds: 0, endSeconds: 2.9 },
          { actor: "buyer", startSeconds: 2.9, endSeconds: 5.8 },
          { actor: "seller", startSeconds: 10.2, endSeconds: 13.1 },
          { actor: "seller", startSeconds: 13.1, endSeconds: 16 },
        ],
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM13":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: [
          { actor: "buyer", startSeconds: 0, endSeconds: 4.2 },
          { actor: "buyer", startSeconds: 11.4, endSeconds: 16 },
          { actor: "seller", startSeconds: 0, endSeconds: 1.5 },
          { actor: "seller", startSeconds: 5.3, endSeconds: 8.1 },
          { actor: "seller", startSeconds: 8.2, endSeconds: 11 },
        ],
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM02":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: [],
        local: strongRemote,
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM03":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: [
          { actor: "buyer", startSeconds: 0, endSeconds: 8 },
          { actor: "buyer", startSeconds: 8, endSeconds: 16 },
          { actor: "seller", startSeconds: 0, endSeconds: 8 },
          { actor: "seller", startSeconds: 8, endSeconds: 16 },
        ],
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM04":
    case "AM04B":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: [
          { actor: "buyer", startSeconds: 0, endSeconds: 8 },
          { actor: "buyer", startSeconds: 8.2, endSeconds: 16 },
          { actor: "seller", startSeconds: 0, endSeconds: 1.1 },
          { actor: "seller", startSeconds: 8.2, endSeconds: 9.3 },
        ],
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM05":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: [
          { actor: "buyer", startSeconds: 0, endSeconds: 5 },
          { actor: "buyer", startSeconds: 11.4, endSeconds: 16 },
        ],
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM06":
      return {
        participantCount: 3,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: [
          ...twoSpeakerDialogue,
          {
            speakerLabel: "speaker_2",
            startSeconds: 16.3,
            endSeconds: 21,
            text: "Я готов зафиксировать промежуточный итог.",
          },
        ],
        remote: [
          ...strongRemote,
          { actor: "broker", startSeconds: 16.3, endSeconds: 18.6 },
          { actor: "broker", startSeconds: 18.7, endSeconds: 21 },
        ],
        local: [],
        livekit: [],
        presence: ["buyer", "seller", "broker"],
      };
    case "AM07":
    case "AM07A":
    case "AM07E":
      return {
        participantCount: 2,
        extraInvitee: true,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: strongRemote,
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM07B":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: strongRemote,
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
        disconnected: ["seller"],
      };
    case "AM07C":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: strongRemote,
        local: [],
        livekit: [],
        presence: ["buyer"],
      };
    case "AM07D":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: strongRemote,
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
        staffPresence: ["facilitator", "observer"],
      };
    case "AM08":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: strongRemote,
        local: [
          { actor: "seller", startSeconds: 0, endSeconds: 5 },
          { actor: "seller", startSeconds: 11.4, endSeconds: 16 },
          { actor: "buyer", startSeconds: 5.3, endSeconds: 8.1 },
          { actor: "buyer", startSeconds: 8.2, endSeconds: 11 },
        ],
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM09":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "SINGLE_SPEAKER_ONLY",
        segments: [
          {
            speakerLabel: "speaker_0",
            startSeconds: 0,
            endSeconds: 8,
            text: "Мы готовы обсуждать условия поставки и сроки вместе.",
          },
          {
            speakerLabel: "speaker_0",
            startSeconds: 8.2,
            endSeconds: 16,
            text: "Давайте начнем с графика поставок.",
          },
        ],
        remote: [
          { actor: "buyer", startSeconds: 0, endSeconds: 8 },
          { actor: "buyer", startSeconds: 8.2, endSeconds: 16 },
        ],
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM10":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: false,
        diarizationStatus: "NOT_REQUESTED",
        segments: [
          {
            speakerLabel: null,
            startSeconds: 0,
            endSeconds: 16,
            text: "Мы готовы обсуждать условия поставки. Для нас главным вопросом являются сроки.",
          },
        ],
        remote: strongRemote,
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM11":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: [
          {
            speakerLabel: "speaker_0",
            startSeconds: 0,
            endSeconds: 10,
            text: "Мы готовы обсуждать условия поставки достаточно подробно.",
          },
          {
            speakerLabel: "speaker_1",
            startSeconds: 10.2,
            endSeconds: 20,
            text: "Для нас главным вопросом остаются сроки и объем.",
          },
        ],
        remote: [
          { actor: "buyer", startSeconds: 0, endSeconds: 2.5 },
          { actor: "buyer", startSeconds: 10.2, endSeconds: 11.2 },
          { actor: "seller", startSeconds: 0, endSeconds: 1.4 },
          { actor: "seller", startSeconds: 10.2, endSeconds: 16.2 },
        ],
        local: [],
        livekit: [],
        presence: ["buyer", "seller"],
      };
    case "AM14":
      return {
        participantCount: 2,
        extraInvitee: false,
        hasDiarization: true,
        diarizationStatus: "COMPLETED",
        segments: twoSpeakerDialogue,
        remote: [],
        local: [],
        livekit: strongRemote,
        presence: ["buyer", "seller"],
      };
    default:
      throw new Error(`${id} is not a seedable pipeline fixture`);
  }
}

async function seedPipelineInputs(
  scenarioId: PostTranscriptionLabScenarioId,
  spec = pipelineSpec(scenarioId),
): Promise<PipelineRunResult["seeded"]> {
  assertPostTranscriptionLabSafety();
  const definition = getLabScenario(scenarioId);
  await cleanupE2eData();

  const [facilitatorUser, buyerUser, sellerUser, observerUser, brokerUser, inviteeUser] =
    await Promise.all([
      insertUser("Lab Facilitator"),
      insertUser("Lab Buyer"),
      insertUser("Lab Seller"),
      insertUser("Lab Observer"),
      spec.participantCount === 3 ? insertUser("Lab Broker") : Promise.resolve(null),
      spec.extraInvitee ? insertUser("Lab Invitee") : Promise.resolve(null),
    ]);
  const negotiationCase = await createE2eCase();
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
    [sessionId, negotiationCase.id, facilitatorUser.id, sessionTitle, negotiationCase.title],
  );

  const roleIds = [e2eId("lab-buyer-role"), e2eId("lab-seller-role"), e2eId("lab-broker-role")];
  const roles = [
    negotiationCase.roles[0]!,
    negotiationCase.roles[1]!,
    {
      name: "Broker",
      privateInstructions: "Broker private",
      objectives: "Broker objective",
      constraints: "Broker constraints",
      hiddenInfo: "Broker hidden",
      fallbackPosition: "Broker fallback",
    },
  ];
  for (let index = 0; index < spec.participantCount; index += 1) {
    const role = roles[index]!;
    await query(
      `INSERT INTO "SessionRole"
        ("id","sessionId","name","privateInstructions","objectives",
         "constraints","hiddenInfo","fallbackPosition","sortOrder","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [
        roleIds[index],
        sessionId,
        role.name,
        role.privateInstructions,
        role.objectives,
        role.constraints,
        role.hiddenInfo,
        role.fallbackPosition,
        index,
      ],
    );
  }

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
    sessionRoleId: roleIds[0]!,
  });
  const seller = await insertParticipant({
    sessionId,
    userId: sellerUser.id,
    email: sellerUser.email,
    type: "PARTICIPANT",
    displayName: "Lab Seller",
    notes: "Seller preparation: floor 140",
    sessionRoleId: roleIds[1]!,
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
  const broker =
    spec.participantCount === 3 && brokerUser
      ? await insertParticipant({
          sessionId,
          userId: brokerUser.id,
          email: brokerUser.email,
          type: "PARTICIPANT",
          displayName: "Lab Broker",
          notes: "Broker preparation: close the gap",
          sessionRoleId: roleIds[2]!,
        })
      : undefined;
  const invitedWithoutPresence =
    spec.extraInvitee && inviteeUser
      ? await insertParticipant({
          sessionId,
          userId: inviteeUser.id,
          email: inviteeUser.email,
          type: "PARTICIPANT",
          displayName: "Lab Invitee Never Entered",
          notes: "Invitee who never entered the room",
          sessionRoleId: null,
        })
      : undefined;

  const recordingId = e2eId("lab-recording");
  await query(
    `INSERT INTO "Recording"
      ("id","sessionId","provider","status","recordingType","fileKey","fileName",
       "mimeType","startedAt","endedAt","updatedAt")
     VALUES ($1,$2,'E2E','COMPLETED','AUDIO_ONLY',$3,'lab-audio.mp4',
       'audio/mp4', NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '5 minutes', NOW())`,
    [recordingId, sessionId, `recordings/${sessionId}/lab-audio.mp4`],
  );
  const recording = (
    await query<{ startedAt: Date | string; endedAt: Date | string }>(
      `SELECT "startedAt","endedAt" FROM "Recording" WHERE "id" = $1`,
      [recordingId],
    )
  )[0];
  if (!recording) {
    throw new Error(`Missing recording for ${scenarioId}`);
  }
  const recordingStartedAt = new Date(recording.startedAt);
  const recordingEndedAt = new Date(recording.endedAt);
  const connectionCreatedAt = new Date(recordingStartedAt.getTime() - 60_000);
  const connectionExpiresAt = new Date(recordingEndedAt.getTime() + 10 * 60_000);
  const disconnectedAt = new Date(recordingStartedAt.getTime() + 8 * 60_000);

  const actors = { buyer, seller, broker };
  for (const key of spec.presence) {
    const actor = actors[key];
    if (actor) {
      await createRoomConnectionForParticipant({
        sessionId,
        userId: actor.userId,
        role: "PARTICIPANT",
        createdAt: connectionCreatedAt,
        expiresAt: connectionExpiresAt,
        disconnectedAt: spec.disconnected?.includes(key) ? disconnectedAt : null,
      });
    }
  }
  const staffActors = { facilitator, observer } as const;
  for (const key of spec.staffPresence ?? []) {
    await createRoomConnectionForParticipant({
      sessionId,
      userId: staffActors[key].userId,
      role: key === "facilitator" ? "FACILITATOR" : "OBSERVER",
      createdAt: connectionCreatedAt,
      expiresAt: connectionExpiresAt,
    });
  }

  const transcriptId = e2eId("lab-transcript");
  const text = spec.segments.map((segment) => segment.text).join(" ");
  await query(
    `INSERT INTO "Transcript"
      ("id","sessionId","recordingId","source","status","text","diarizedText",
       "hasSpeakerDiarization","speakerMapping","speakerMappingStatus",
       "diarizationStatus","retranscribeCount","processingMetadata",
       "completedAt","updatedAt")
     VALUES
      ($1,$2,$3,'GENERATED','COMPLETED',$4,$5,
       $6, NULL, $7,
       $8, 0, $9::jsonb,
       NOW(),NOW())`,
    [
      transcriptId,
      sessionId,
      recordingId,
      text,
      spec.hasDiarization
        ? spec.segments
            .map(
              (segment) =>
                `[${segment.startSeconds.toFixed(1)}-${segment.endSeconds.toFixed(1)}] ${segment.speakerLabel ?? "unknown"}: ${segment.text}`,
            )
            .join("\n")
        : text,
      spec.hasDiarization,
      spec.hasDiarization ? "REQUIRED" : "NOT_REQUIRED",
      spec.diarizationStatus,
      JSON.stringify({
        transcriptEnhancement: { status: "COMPLETED", source: "post-transcription-lab" },
      }),
    ],
  );

  for (const [index, segment] of spec.segments.entries()) {
    await query(
      `INSERT INTO "TranscriptSegment"
        ("id","transcriptId","speakerLabel","mappedParticipantId","startSeconds",
         "endSeconds","text","orderIndex","updatedAt")
       VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,NOW())`,
      [
        e2eId("lab-seg"),
        transcriptId,
        segment.speakerLabel,
        segment.startSeconds,
        segment.endSeconds,
        segment.text,
        index,
      ],
    );
  }

  const activityActors = { buyer, seller, broker };
  for (const [source, windows] of [
    [REMOTE, spec.remote],
    [LOCAL, spec.local],
    [LIVEKIT, spec.livekit],
  ] as const) {
    for (const window of windows) {
      const actor = activityActors[window.actor];
      if (!actor) {
        throw new Error(`Missing actor ${window.actor} for ${scenarioId}`);
      }
      await createAudioActivity(
        sessionId,
        actor.participantId,
        window.startSeconds,
        window.endSeconds,
        source,
      );
    }
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
    broker,
    invitedWithoutPresence,
    facilitatorAuthCookie: await createUserSessionCookie(facilitator.userId),
  };
}

export async function loadPipelineActual(
  seeded: PipelineRunResult["seeded"],
): Promise<PipelineActual> {
  const transcript = (
    await query<{
      speakerMappingStatus: string | null;
      speakerMapping: unknown;
      speakerMappingConfirmedAt: Date | string | null;
      speakerMappingConfirmedBy: string | null;
      processingMetadata: unknown;
      hasSpeakerDiarization: boolean;
    }>(
      `SELECT "speakerMappingStatus","speakerMapping","speakerMappingConfirmedAt",
              "speakerMappingConfirmedBy","processingMetadata","hasSpeakerDiarization"
       FROM "Transcript" WHERE "sessionId" = $1`,
      [seeded.sessionId],
    )
  )[0];
  const segments = await query<{
    speakerLabel: string | null;
    mappedParticipantId: string | null;
    mappingSource: string | null;
    mappingConfidence: number | null;
    text: string;
  }>(
    `SELECT "speakerLabel","mappedParticipantId","mappingSource","mappingConfidence","text"
     FROM "TranscriptSegment" WHERE "transcriptId" = $1 ORDER BY "orderIndex"`,
    [seeded.transcriptId],
  );
  const metadata =
    transcript?.processingMetadata && typeof transcript.processingMetadata === "object"
      ? (transcript.processingMetadata as Record<string, unknown>)
      : {};
  const suggestion =
    metadata.mappingSuggestion && typeof metadata.mappingSuggestion === "object"
      ? (metadata.mappingSuggestion as Record<string, unknown>)
      : {};
  const mapping =
    transcript?.speakerMapping && typeof transcript.speakerMapping === "object"
      ? (transcript.speakerMapping as Record<string, string | null>)
      : {};
  const participants = await query<{ id: string; type: string }>(
    `SELECT "id","type" FROM "SessionParticipant" WHERE "sessionId" = $1`,
    [seeded.sessionId],
  );
  const completeness = evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: Boolean(transcript?.hasSpeakerDiarization),
    speakerMappingStatus: transcript?.speakerMappingStatus ?? null,
    segments,
    participants,
  });
  const structuralComplete = completeness.structurallyComplete && completeness.readyForAnalysis;
  const candidateParticipantIds = Array.isArray(suggestion.candidateParticipantIds)
    ? suggestion.candidateParticipantIds.filter((id): id is string => typeof id === "string")
    : [];
  const presentRows = await query<{ userId: string }>(
    `SELECT DISTINCT "userId" FROM "SessionRoomConnection" WHERE "sessionId" = $1`,
    [seeded.sessionId],
  );

  return {
    speakerMappingStatus: transcript?.speakerMappingStatus ?? null,
    speakerMapping: mapping,
    segmentAssignments: segments.map((segment) => ({
      speakerLabel: segment.speakerLabel,
      mappedParticipantId: segment.mappedParticipantId,
      mappingSource: segment.mappingSource,
      mappingConfidence: segment.mappingConfidence,
    })),
    confirmedAt: transcript?.speakerMappingConfirmedAt
      ? String(transcript.speakerMappingConfirmedAt)
      : null,
    confirmedBy: transcript?.speakerMappingConfirmedBy ?? null,
    selectedSource:
      typeof suggestion.selectedTelemetrySource === "string"
        ? suggestion.selectedTelemetrySource
        : null,
    isApplied: typeof suggestion.isApplied === "boolean" ? suggestion.isApplied : null,
    reason: typeof suggestion.reason === "string" ? suggestion.reason : null,
    weakMarginDetected:
      typeof suggestion.weakMarginDetected === "boolean"
        ? suggestion.weakMarginDetected
        : null,
    weakMarginOverriddenByGlobalEvidence:
      typeof suggestion.weakMarginOverriddenByGlobalEvidence === "boolean"
        ? suggestion.weakMarginOverriddenByGlobalEvidence
        : null,
    globalAssignmentMargin:
      typeof suggestion.globalAssignmentMargin === "number"
        ? suggestion.globalAssignmentMargin
        : null,
    minConfidence:
      typeof suggestion.minConfidence === "number" ? suggestion.minConfidence : null,
    candidateParticipantIds,
    presentUserIds: presentRows.map((row) => row.userId),
    structuralComplete,
    aiReadyByCurrentContract: completeness.readyForAnalysis,
  };
}

function comparePipeline(
  seeded: PipelineRunResult["seeded"],
  expected: PipelineExpected,
  actual: PipelineActual,
): string[] {
  const failures: string[] = [];
  if (!expected.statusIn.includes(actual.speakerMappingStatus ?? "")) {
    failures.push(
      `status ${actual.speakerMappingStatus} not in ${expected.statusIn.join("|")}`,
    );
  }
  if (expected.applied !== Boolean(actual.isApplied)) {
    failures.push(`isApplied expected ${expected.applied}, actual ${actual.isApplied}`);
  }
  if (
    actual.selectedSource &&
    !expected.selectedSourceIn.includes(
      actual.selectedSource as (typeof expected.selectedSourceIn)[number],
    )
  ) {
    failures.push(`selectedSource ${actual.selectedSource} not in ${expected.selectedSourceIn.join("|")}`);
  }
  if (expected.confirmedNull && (actual.confirmedAt || actual.confirmedBy)) {
    failures.push("confirmation timestamps must remain null before human/AI acceptance");
  }
  const expectedIds = expectedAssignmentIds(seeded, expected.assignment);
  if (expectedIds) {
    for (const [label, participantId] of Object.entries(expectedIds)) {
      if (actual.speakerMapping[label] !== participantId) {
        failures.push(
          `assignment ${label} expected ${participantId}, actual ${actual.speakerMapping[label] ?? "null"}`,
        );
      }
    }
  }
  if (expected.overrideReached === true && actual.weakMarginOverriddenByGlobalEvidence !== true) {
    failures.push("expected 2x2 global-margin override to be reached");
  }
  if (["AM07", "AM07A", "AM07B", "AM07D", "AM07E"].includes(seeded.definition.id)) {
    if (!actual.candidateParticipantIds.includes(seeded.buyer.participantId)) {
      failures.push("buyer missing from canonical candidate pool");
    }
    if (!actual.candidateParticipantIds.includes(seeded.seller.participantId)) {
      failures.push("seller missing from canonical candidate pool");
    }
  }
  if (["AM07", "AM07A", "AM07E"].includes(seeded.definition.id) && seeded.invitedWithoutPresence) {
    if (actual.candidateParticipantIds.includes(seeded.invitedWithoutPresence.participantId)) {
      failures.push("never-entered invitee must not be a speaker-mapping candidate");
    }
    if (actual.presentUserIds.includes(seeded.invitedWithoutPresence.userId)) {
      failures.push("invitee unexpectedly has room presence");
    }
  }
  if (seeded.definition.id === "AM07C") {
    if (!actual.candidateParticipantIds.includes(seeded.buyer.participantId)) {
      failures.push("present buyer must remain a candidate");
    }
    if (actual.candidateParticipantIds.includes(seeded.seller.participantId)) {
      failures.push("never-entered seller must not be a speaker-mapping candidate");
    }
  }
  if (seeded.definition.id === "AM07D") {
    if (actual.candidateParticipantIds.includes(seeded.facilitator.participantId)) {
      failures.push("facilitator must not be a negotiation speaker candidate");
    }
    if (actual.candidateParticipantIds.includes(seeded.observer.participantId)) {
      failures.push("observer must not be a negotiation speaker candidate");
    }
  }
  if (seeded.definition.id === "AM04B") {
    const constructedManyToOne = {
      speaker_0: seeded.buyer.participantId,
      speaker_1: seeded.buyer.participantId,
    };
    const safety = evaluateMappingSafety({
      mapping: constructedManyToOne,
      rawSpeakerLabels: ["speaker_0", "speaker_1"],
      participantIds: [seeded.buyer.participantId, seeded.seller.participantId],
      mode: "multi_device",
    });
    const decision = decideAutoMappingApplication({
      allSpeakersCovered: true,
      highConfidence: true,
      weakMargin: false,
      mappingSafetySafe: safety.safe,
      mappingSafetyReason: safety.reason,
      rawSpeakerCount: 2,
      expectedParticipantCount: 2,
      activeParticipantsDuringRecording: 2,
      hasOffsets: true,
      hasDerivedOffsets: false,
      telemetryWarnings: [],
    });
    if (safety.safe) {
      failures.push("AM04B decision-core: constructed many-to-one must be unsafe");
    }
    if (decision.shouldApply) {
      failures.push("AM04B decision-core: many-to-one must not auto-apply");
    }
    if (decision.reason !== "many_to_one_mapping_in_multi_participant_session") {
      failures.push(`AM04B decision-core reason ${decision.reason}`);
    }
  }
  if (seeded.definition.id === "AM10" && actual.isApplied) {
    failures.push("no-diarization fixture must not fabricate an applied mapping");
  }
  if (seeded.definition.id === "AM14" && actual.isApplied) {
    failures.push("LIVEKIT-only rows must not be treated as a current scored source");
  }
  return failures;
}

async function loadPipelineInputReport(seeded: PipelineRunResult["seeded"]): Promise<string> {
  const segments = await query<{
    speakerLabel: string | null;
    startSeconds: number;
    endSeconds: number;
    text: string;
  }>(
    `SELECT "speakerLabel","startSeconds","endSeconds","text"
     FROM "TranscriptSegment" WHERE "transcriptId" = $1 ORDER BY "orderIndex"`,
    [seeded.transcriptId],
  );
  const activities = await query<{
    source: string;
    displayName: string | null;
    startedOffsetSeconds: number | null;
    endedOffsetSeconds: number | null;
  }>(
    `SELECT a."source", p."displayName", a."startedOffsetSeconds", a."endedOffsetSeconds"
     FROM "SessionParticipantAudioActivity" a
     JOIN "SessionParticipant" p ON p."id" = a."sessionParticipantId"
     WHERE a."sessionId" = $1
     ORDER BY a."source", a."startedOffsetSeconds"`,
    [seeded.sessionId],
  );
  const candidates = await query<{ id: string; displayName: string | null; type: string }>(
    `SELECT "id","displayName","type" FROM "SessionParticipant"
     WHERE "sessionId" = $1 AND "type" = 'PARTICIPANT' ORDER BY "createdAt"`,
    [seeded.sessionId],
  );
  const present = await query<{ displayName: string | null }>(
    `SELECT DISTINCT p."displayName"
     FROM "SessionRoomConnection" c
     JOIN "SessionParticipant" p ON p."userId" = c."userId" AND p."sessionId" = c."sessionId"
     WHERE c."sessionId" = $1`,
    [seeded.sessionId],
  );
  return [
    "SPEAKER SEGMENTS:",
    ...segments.map(
      (segment) =>
        `${segment.speakerLabel ?? "null"} ${segment.startSeconds}-${segment.endSeconds} ${segment.text}`,
    ),
    "",
    "TELEMETRY:",
    ...activities.map(
      (row) =>
        `${row.source} ${row.displayName ?? "unknown"} ${row.startedOffsetSeconds}-${row.endedOffsetSeconds}`,
    ),
    activities.length === 0 ? "(none)" : "",
    "",
    "ROOM PRESENCE",
    present.map((row) => row.displayName).join(", ") || "(none)",
    seeded.invitedWithoutPresence
      ? `invitedWithoutPresence=${seeded.invitedWithoutPresence.displayName} (no SessionRoomConnection)`
      : "",
    "",
    "CANDIDATE SET",
    "Canonical candidates: historical room presence ∩ SessionParticipant.type=PARTICIPANT.",
    ...candidates.map((row) => `${row.displayName}=${row.id}`),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function formatBefore(
  seeded: PipelineRunResult["seeded"],
  expected: PipelineExpected,
  inputReport: string,
): string {
  return [
    "======================================================================",
    "SCENARIO",
    `${seeded.definition.id} — ${seeded.definition.title}`,
    "FIXTURE_CLASS = PIPELINE_FIXTURE",
    "",
    "PARTICIPANTS",
    `facilitator=${seeded.facilitator.displayName}`,
    `buyer=${seeded.buyer.displayName}`,
    `seller=${seeded.seller.displayName}`,
    seeded.broker ? `broker=${seeded.broker.displayName}` : "",
    seeded.invitedWithoutPresence
      ? `invitedWithoutPresence=${seeded.invitedWithoutPresence.displayName}`
      : "",
    "",
    "PARTICIPANT TYPES",
    "FACILITATOR, PARTICIPANT, PARTICIPANT, OBSERVER" +
      (seeded.broker ? ", PARTICIPANT" : "") +
      (seeded.invitedWithoutPresence ? ", PARTICIPANT(invitee)" : ""),
    "",
    inputReport,
    "",
    "EXPECTED SAFETY OUTCOME",
    expected.notes,
    `applied=${expected.applied} statusIn=${expected.statusIn.join("|")}`,
    `sourceIn=${expected.selectedSourceIn.join("|")}`,
    `AUTO_MAPPING_HIGH_CONFIDENCE=${AUTO_MAPPING_HIGH_CONFIDENCE}`,
    `AUTO_MAPPING_MIN_MARGIN=${AUTO_MAPPING_MIN_MARGIN}`,
    "======================================================================",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatAfter(
  expected: PipelineExpected,
  actual: PipelineActual,
  pass: boolean,
  failures: string[],
): string {
  return [
    "ACTUAL SPEAKER MAPPING STATUS",
    String(actual.speakerMappingStatus),
    "ACTUAL CLUSTER MAPPING",
    JSON.stringify(actual.speakerMapping),
    "ACTUAL SEGMENT mappedParticipantId",
    JSON.stringify(actual.segmentAssignments),
    "ACTUAL mappingSource / confidence",
    JSON.stringify(
      actual.segmentAssignments.map((segment) => ({
        label: segment.speakerLabel,
        source: segment.mappingSource,
        confidence: segment.mappingConfidence,
      })),
    ),
    `ACTUAL selectedSource=${actual.selectedSource}`,
    `ACTUAL reason=${actual.reason}`,
    `ACTUAL minConfidence=${actual.minConfidence}`,
    `ACTUAL globalAssignmentMargin=${actual.globalAssignmentMargin}`,
    `ACTUAL weakMarginDetected=${actual.weakMarginDetected}`,
    `ACTUAL weakMarginOverriddenByGlobalEvidence=${actual.weakMarginOverriddenByGlobalEvidence}`,
    `mappingSuggestion.isApplied=${actual.isApplied}`,
    `STRUCTURAL COMPLETENESS=${actual.structuralComplete}`,
    `AI READINESS=${actual.aiReadyByCurrentContract}`,
    "",
    "EXPECTED vs ACTUAL",
    `expectedStatus=${expected.statusIn.join("|")} actualStatus=${actual.speakerMappingStatus}`,
    `expectedApplied=${expected.applied} actualApplied=${actual.isApplied}`,
    "",
    pass ? "PASS" : `FAIL\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  ].join("\n");
}

export async function runProductionAutoSpeakerMapping(sessionId: string): Promise<unknown> {
  const e2eUrl = process.env.E2E_DATABASE_URL?.trim();
  if (!e2eUrl) {
    throw new Error("PIPELINE_FIXTURE requires E2E_DATABASE_URL");
  }

  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const scriptPath = path.join(process.cwd(), "scripts", "lab-run-auto-speaker-mapping.ts");

  const { stdout, stderr, code } = await new Promise<{
    stdout: string;
    stderr: string;
    code: number;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", scriptPath, sessionId], {
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
      `Production autoTriggerSpeakerMappingAfterTranscription failed: ${stderr.trim() || stdout.trim() || `exit ${code}`}`,
    );
  }

  const jsonLine = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .at(-1);
  return jsonLine ? JSON.parse(jsonLine) : null;
}

export async function runPipelineLabScenario(
  scenarioId: PostTranscriptionLabScenarioId | string,
): Promise<PipelineRunResult> {
  const definition = getLabScenario(scenarioId);
  if (definition.fixtureClass !== "PIPELINE_FIXTURE") {
    throw new Error(`${definition.id} is not a PIPELINE_FIXTURE`);
  }
  const expected = pipelineExpectation(definition.id);
  const seeded = await seedPipelineInputs(definition.id);
  const beforeReport = formatBefore(
    seeded,
    expected,
    await loadPipelineInputReport(seeded),
  );
  console.log(beforeReport);
  await runProductionAutoSpeakerMapping(seeded.sessionId);
  const actual = await loadPipelineActual(seeded);
  const failures = comparePipeline(seeded, expected, actual);
  const pass = failures.length === 0;
  const afterReport = formatAfter(expected, actual, pass, failures);
  console.log(afterReport);
  return { seeded, expected, actual, pass, failures, beforeReport, afterReport };
}

export function formatPipelineCheckpointRow(result: PipelineRunResult): string {
  const assignment = Object.entries(result.actual.speakerMapping)
    .map(([label, id]) => `${label}=${id ?? "null"}`)
    .join(",");
  return [
    result.seeded.definition.id,
    result.expected.statusIn.join("|"),
    result.actual.speakerMappingStatus ?? "null",
    result.expected.assignment
      ? Object.entries(result.expected.assignment)
          .map(([label, key]) => `${label}=${key}`)
          .join(",")
      : "(review/no apply)",
    assignment || "(none)",
    result.actual.selectedSource ?? "null",
    result.actual.reason ?? "null",
    result.pass ? "PASS" : "FAIL",
  ].join("\t");
}
