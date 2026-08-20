import { createHash } from "node:crypto";

import { areNotesMaterialToNegotiationAnalysis } from "@/lib/ai/material-negotiation-notes";

export const MATERIAL_INPUT_SCHEMA_VERSION = 1 as const;

/**
 * Prisma-free snapshot of the fields that are actually material to the
 * current negotiation analysis prompt. Built from the same
 * `SessionAnalysisContext` object used to render the prompt.
 */
export type MaterialAnalysisSnapshot = {
  session: {
    title: string;
    caseTitle: string;
    caseLanguage: string;
    publicInstructions: string;
    businessContext: string;
    preparationDurationSeconds: number;
    durationSeconds: number;
    sequenceNumber: number | null;
  };
  event: { title: string } | null;
  roles: Array<{
    name: string;
    objectives: string;
    constraints: string;
    hiddenInfo: string;
    fallbackPosition: string;
  }>;
  participants: Array<{
    id: string;
    displayName: string;
    type: string;
    roleName: string | null;
    notes: string;
  }>;
  transcript: {
    text: string;
    diarizedText: string | null;
    language: string | null;
    hasSpeakerDiarization: boolean;
    segments: Array<{
      orderIndex: number;
      speakerLabel: string | null;
      mappedParticipantId: string | null;
      mappedParticipantName: string | null;
      startSeconds: number | null;
      endSeconds: number | null;
      text: string;
    }>;
  } | null;
};

export type MaterialInputEnvelope = {
  schemaVersion: typeof MATERIAL_INPUT_SCHEMA_VERSION;
  language: string;
  session: {
    title: string;
    caseTitle: string;
    publicInstructions: string;
    businessContext: string;
    preparationDurationSeconds: number;
    durationSeconds: number;
    sequenceNumber: number | null;
  };
  eventTitle: string | null;
  roles: Array<{
    name: string;
    objectives: string;
    constraints: string;
    hiddenInfo: string;
    fallbackPosition: string;
  }>;
  participants: Array<{
    id: string;
    displayName: string;
    type: string;
    roleName: string | null;
    notes: string | null;
  }>;
  transcript: {
    text: string;
    diarizedText: string | null;
    language: string | null;
    hasSpeakerDiarization: boolean;
    segments: Array<{
      orderIndex: number;
      speakerLabel: string | null;
      mappedParticipantId: string | null;
      mappedParticipantName: string | null;
      startSeconds: number | null;
      endSeconds: number | null;
      text: string;
    }>;
  } | null;
};

export const NON_MATERIAL_FINGERPRINT_CONTROL_FIELD =
  "SessionRole.privateInstructions" as const;

function normalizeSafeText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.normalize("NFC").trim();
  return normalized.length > 0 ? normalized : null;
}

function canonicalize(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value.normalize("NFC");
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return null;
}

export function serializeMaterialInputEnvelope(
  envelope: MaterialInputEnvelope,
): string {
  return JSON.stringify(canonicalize(envelope));
}

export function hashMaterialInputEnvelope(
  envelope: MaterialInputEnvelope,
): string {
  return createHash("sha256")
    .update(serializeMaterialInputEnvelope(envelope), "utf8")
    .digest("hex");
}

export function buildMaterialInputEnvelope(
  snapshot: MaterialAnalysisSnapshot,
): MaterialInputEnvelope {
  const roles = [...snapshot.roles]
    .map((role) => ({
      name: role.name.normalize("NFC"),
      objectives: role.objectives.normalize("NFC"),
      constraints: role.constraints.normalize("NFC"),
      hiddenInfo: role.hiddenInfo.normalize("NFC"),
      fallbackPosition: role.fallbackPosition.normalize("NFC"),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const participants = [...snapshot.participants]
    .map((participant) => ({
      id: participant.id,
      displayName: participant.displayName.normalize("NFC"),
      type: participant.type,
      roleName: participant.roleName,
      notes: areNotesMaterialToNegotiationAnalysis(participant.type)
        ? normalizeSafeText(participant.notes)
        : null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const transcript = snapshot.transcript
    ? {
        text: snapshot.transcript.text.normalize("NFC"),
        diarizedText: snapshot.transcript.diarizedText
          ? snapshot.transcript.diarizedText.normalize("NFC")
          : null,
        language: snapshot.transcript.language,
        hasSpeakerDiarization: snapshot.transcript.hasSpeakerDiarization,
        segments: [...snapshot.transcript.segments]
          .map((segment) => ({
            orderIndex: segment.orderIndex,
            speakerLabel: segment.speakerLabel,
            mappedParticipantId: segment.mappedParticipantId,
            mappedParticipantName: segment.mappedParticipantName,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
            text: segment.text.normalize("NFC"),
          }))
          .sort((left, right) => left.orderIndex - right.orderIndex),
      }
    : null;

  return {
    schemaVersion: MATERIAL_INPUT_SCHEMA_VERSION,
    language: snapshot.session.caseLanguage,
    session: {
      title: snapshot.session.title.normalize("NFC"),
      caseTitle: snapshot.session.caseTitle.normalize("NFC"),
      publicInstructions: snapshot.session.publicInstructions.normalize("NFC"),
      businessContext: snapshot.session.businessContext.normalize("NFC"),
      preparationDurationSeconds: snapshot.session.preparationDurationSeconds,
      durationSeconds: snapshot.session.durationSeconds,
      sequenceNumber: snapshot.session.sequenceNumber,
    },
    eventTitle: snapshot.event?.title ?? null,
    roles,
    participants,
    transcript,
  };
}

export function fingerprintMaterialAnalysisSnapshot(
  snapshot: MaterialAnalysisSnapshot,
): string {
  return hashMaterialInputEnvelope(buildMaterialInputEnvelope(snapshot));
}
