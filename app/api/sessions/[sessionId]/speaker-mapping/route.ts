import { NextResponse } from "next/server";
import { z } from "zod";

import { applyFacilitatorMaterialInputChange, materialChangeGuardErrorBody } from "@/lib/ai/material-input-invalidation";
import { prisma } from "@/lib/prisma";
import {
  authorizeSessionManagementAccess,
  authorizeSessionMaterialsAccess,
  resolveSessionManagerActorId,
  sessionAuthTokensFrom,
} from "@/lib/session-management-auth";
import {
  getUniqueSpeakerLabels,
  getDisplaySpeakerLabel,
  type SpeakerMapping,
} from "@/lib/transcription/speaker-labels";
import { persistMappingOwnedTranscriptUpdate, mappingGenerationMismatchBody, MappingGenerationMismatchError, MappingIncompleteError } from "@/lib/transcription/mapping-persistence";
import { deriveSpeakerMappingStatus, resolveSpeakerMappingForUi } from "@/lib/transcription/speaker-mapping-state";
import { suggestSpeakerMapping } from "@/lib/transcription/auto-speaker-mapping";
import { loadCanonicalSpeakerMappingCandidates } from "@/lib/transcription/speaker-mapping-candidate-load";
import { resolveSegmentEnhancementProvenance } from "@/lib/post-processing/enhancement-ux-presentation";
import { parseTranscriptEnhancementPublication } from "@/lib/services/transcript-enhancement-publication";

export const runtime = "nodejs";
type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function summarizeMappingValues(mapping: Record<string, string | null>) {
  return Object.entries(mapping).reduce<Record<string, string | null>>(
    (summary, [speakerLabel, participantId]) => {
      summary[speakerLabel] =
        typeof participantId === "string" && participantId.length > 8
          ? participantId.slice(0, 8)
          : participantId;
      return summary;
    },
    {},
  );
}

async function getSpeakerMappingCandidates(sessionId: string) {
  return loadCanonicalSpeakerMappingCandidates(sessionId);
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const url = new URL(request.url);
  const authorization = await authorizeSessionMaterialsAccess(
    sessionId,
    sessionAuthTokensFrom(url),
  );
  if (!authorization.ok) {
    return authorization.response;
  }

  const isFacilitator = authorization.projection.isManagerProjection;

  const transcript = await prisma.transcript.findUnique({
    where: { sessionId },
    include: {
      segments: { orderBy: { orderIndex: "asc" } },
    },
  });

  if (!transcript) {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }

  const sessionParticipants = await getSpeakerMappingCandidates(sessionId);

  const existingMapping = resolveSpeakerMappingForUi({
    speakerMapping: transcript.speakerMapping,
    speakerMappingStatus: transcript.speakerMappingStatus,
    processingMetadata: transcript.processingMetadata,
  });
  const labelOrder = getUniqueSpeakerLabels(
    transcript.segments.map((s) => ({
      speakerLabel: s.speakerLabel,
      displaySpeakerLabel: s.speakerLabel
        ? getDisplaySpeakerLabel(
            s.speakerLabel,
            transcript.segments
              .map((seg) => seg.speakerLabel)
              .filter((l): l is string => Boolean(l)),
          )
        : null,
    })),
  );

  const detectedSpeakers = labelOrder.map((label) => ({
    speakerLabel: label.speakerLabel,
    displaySpeakerLabel: label.displaySpeakerLabel,
    suggestedParticipantId: existingMapping[label.speakerLabel] ?? null,
    mappedParticipantId: existingMapping[label.speakerLabel] ?? null,
    confidence: null as number | null,
    evidence: null as string | null,
  }));

  const participants = sessionParticipants.map((p) => ({
    sessionParticipantId: p.sessionParticipantId,
    displayName: p.displayName,
    participantType: p.participantType,
    roleName: p.roleName,
  }));

  return NextResponse.json({
    transcriptId: transcript.id,
    retranscribeCount: transcript.retranscribeCount ?? 0,
    speakerMappingStatus: transcript.speakerMappingStatus,
    speakerMappingConfirmedAt: transcript.speakerMappingConfirmedAt?.toISOString() ?? null,
    speakerMappingConfirmedBy: transcript.speakerMappingConfirmedBy ?? null,
    hasSpeakerDiarization: transcript.hasSpeakerDiarization,
    diarizationStatus: transcript.diarizationStatus ?? null,
    detectedSpeakers,
    participants,
    canEdit: isFacilitator,
  });
}

// ── POST ─────────────────────────────────────────────────────────────────────

const speakerMappingSchema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  transcriptId: z.string().trim().min(1),
  expectedRetranscribeCount: z.number().int().nonnegative(),
  mapping: z.record(z.string(), z.string().nullable()).optional().default({}),
  confirm: z.boolean().optional().default(false),
  applyToTranscript: z.boolean().optional().default(true),
  suggestAutomatically: z.boolean().optional().default(false),
  /** When true, overwrite locked manual overrides with new cluster mapping */
  forceOverrideLocked: z.boolean().optional().default(false),
  /** Legacy: applyOnly means re-apply existing saved mapping, not save new one */
  applyOnly: z.boolean().optional(),
  confirmRewindPublication: z.boolean().optional(),
});

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = speakerMappingSchema.safeParse(body);
  if (!parsed.success) {
    console.warn("[speaker-mapping][api] validation_failed", {
      sessionId,
      validationResult: "invalid_request",
      issueCount: parsed.error.issues.length,
      firstIssue: parsed.error.issues[0]?.message ?? "Invalid request.",
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const {
    mapping,
    confirm,
    applyToTranscript,
    applyOnly,
    suggestAutomatically,
    forceOverrideLocked,
    confirmRewindPublication,
    transcriptId: requestedTranscriptId,
    expectedRetranscribeCount,
  } = parsed.data;

  const authorization = await authorizeSessionManagementAccess(
    sessionId,
    sessionAuthTokensFrom(parsed.data),
  );
  if (!authorization.ok) {
    return authorization.response;
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId },
    select: { deletedAt: true },
  });

  if (session?.deletedAt) {
    return NextResponse.json({ error: "Session is read-only." }, { status: 403 });
  }

  const transcript = await prisma.transcript.findUnique({
    where: { sessionId },
    include: {
      segments: { orderBy: { orderIndex: "asc" } },
    },
  });

  if (!transcript) {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }
  if (
    requestedTranscriptId !== transcript.id ||
    expectedRetranscribeCount !== (transcript.retranscribeCount ?? 0)
  ) {
    return NextResponse.json(mappingGenerationMismatchBody(), { status: 409 });
  }

  const sessionParticipants = await getSpeakerMappingCandidates(sessionId);

  // ── Suggest automatically ────────────────────────────────────────────────
  if (suggestAutomatically) {
    const suggestion = await suggestSpeakerMapping(sessionId, transcript);
    try {
      await prisma.$transaction(async (tx) => {
        const persisted = await persistMappingOwnedTranscriptUpdate({
          tx,
          transcriptId: transcript.id,
          expectedTranscriptId: requestedTranscriptId,
          expectedRetranscribeCount,
          patch: {
            mappingSuggestion: {
              candidateMapping: suggestion.mapping,
              confidence: suggestion.confidence,
              reason: suggestion.available
                ? "auto_suggested"
                : `unavailable:${suggestion.unavailableReason ?? "unknown"}`,
              unavailableReason: suggestion.unavailableReason,
              telemetryQuality: suggestion.telemetryQuality,
            },
          },
          rebuildDiarizedText: false,
        });
        if (!persisted.ok) {
          throw new MappingGenerationMismatchError();
        }
      });
    } catch (error) {
      if (error instanceof MappingGenerationMismatchError) {
        return NextResponse.json(mappingGenerationMismatchBody(), { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({
      suggestedMapping: suggestion.mapping,
      confidence: suggestion.confidence,
      telemetryQuality: suggestion.telemetryQuality,
      telemetryHealth: suggestion.telemetryHealth,
      available: suggestion.available,
      unavailableReason: suggestion.unavailableReason,
    });
  }

  const labelOrder = getUniqueSpeakerLabels(
    transcript.segments.map((segment) => ({
      speakerLabel: segment.speakerLabel,
      displaySpeakerLabel: segment.speakerLabel
        ? getDisplaySpeakerLabel(
            segment.speakerLabel,
            transcript.segments
              .map((s) => s.speakerLabel)
              .filter((label): label is string => Boolean(label)),
          )
        : null,
    })),
  ).map((label) => label.speakerLabel);

  // ── Build sanitized mapping ───────────────────────────────────────────────
  const participantIds = new Set(sessionParticipants.map((p) => p.sessionParticipantId));
  const sanitizedMapping: SpeakerMapping = {};
  for (const speakerLabel of labelOrder) {
    const participantId = mapping[speakerLabel];
    sanitizedMapping[speakerLabel] =
      typeof participantId === "string" &&
      participantId.trim().length > 0 &&
      participantIds.has(participantId)
        ? participantId
        : null;
  }
  console.info("[speaker-mapping][api] request_received", {
    sessionId,
    transcriptId: transcript.id,
    speakerLabelsReceived: labelOrder,
    mappingKeys: Object.keys(mapping),
    mappingValuePreview: summarizeMappingValues(mapping),
    confirm,
    validationResult: "ok",
    applyOnly,
    applyToTranscript,
    forceOverrideLocked,
  });

  const participantDisplayInfo = sessionParticipants.map((p) => ({
    id: p.sessionParticipantId,
    displayName: p.displayName,
    type: p.participantType,
    roleName: p.roleName,
  }));

  const statusDecision = deriveSpeakerMappingStatus({
    hasSpeakerDiarization: transcript.hasSpeakerDiarization,
    speakerLabels: labelOrder,
    mapping: sanitizedMapping,
    confirm,
    previousStatus: transcript.speakerMappingStatus,
  });

  if (!applyOnly && confirm && !statusDecision.canConfirm) {
    console.warn("[speaker-mapping][api] confirmation_blocked", {
      sessionId,
      transcriptId: transcript.id,
      speakerLabelsReceived: labelOrder,
      mappingKeys: Object.keys(sanitizedMapping),
      mappingValuePreview: summarizeMappingValues(sanitizedMapping),
      confirm,
      validationResult: "incomplete_mapping_for_confirm",
    });
    return NextResponse.json(
      { error: "Assign all detected speakers before confirming mapping." },
      { status: 400 },
    );
  }

  const newMappingStatus = statusDecision.status;
  const keepExistingConfirmation =
    !applyOnly &&
    newMappingStatus === "CONFIRMED" &&
    transcript.speakerMappingStatus === "CONFIRMED" &&
    Boolean(transcript.speakerMappingConfirmedAt);
  const confirmedAt =
    !applyOnly && newMappingStatus === "CONFIRMED"
      ? keepExistingConfirmation
        ? transcript.speakerMappingConfirmedAt
        : new Date()
      : null;
  const confirmedBy =
    !applyOnly && newMappingStatus === "CONFIRMED"
      ? keepExistingConfirmation
        ? transcript.speakerMappingConfirmedBy
        : resolveSessionManagerActorId({
            participantId: authorization.participant?.id,
            userId: authorization.user?.id,
            fallbackDisplayName: authorization.actorDisplayName,
          })
      : null;

  const change = await (async () => {
    try {
      return await applyFacilitatorMaterialInputChange({
    sessionId,
    confirmRewindPublication,
    fenceEnhancementPublication: false,
    mutate: async (tx) => {
      const persistParams = {
        tx,
        transcriptId: transcript.id,
        expectedTranscriptId: requestedTranscriptId,
        expectedRetranscribeCount,
        rebuildDiarizedText: applyToTranscript || Boolean(applyOnly),
        participants: participantDisplayInfo.map((item) => ({
          id: item.id,
          displayName: item.displayName,
          type: item.type,
          roleName: item.roleName,
        })),
      } as const;
      const persisted = applyOnly
        ? await persistMappingOwnedTranscriptUpdate({
            ...persistParams,
            patch: {},
          })
        : await persistMappingOwnedTranscriptUpdate({
            ...persistParams,
            patch: {
              speakerMappingStatus: newMappingStatus,
              speakerMappingConfirmedAt: confirmedAt,
              speakerMappingConfirmedBy: confirmedBy,
            },
            requestedMapping: mapping,
            requireCompleteMapping: confirm,
            forceOverrideLocked,
          });
      if (!persisted.ok) {
        if (persisted.reason === "incomplete_mapping") {
          throw new MappingIncompleteError();
        }
        throw new MappingGenerationMismatchError();
      }

      return tx.transcript.findUniqueOrThrow({
        where: { id: transcript.id },
        include: {
          segments: { orderBy: { orderIndex: "asc" } },
        },
      });
    },
      });
    } catch (error) {
      if (error instanceof MappingGenerationMismatchError) {
        return { ok: false as const, mismatch: true as const };
      }
      if (error instanceof MappingIncompleteError) {
        return { ok: false as const, incomplete: true as const };
      }
      throw error;
    }
  })();
  if ("mismatch" in change && change.mismatch) {
    return NextResponse.json(mappingGenerationMismatchBody(), { status: 409 });
  }
  if ("incomplete" in change && change.incomplete) {
    return NextResponse.json(
      { error: "Assign all detected speakers before confirming mapping." },
      { status: 400 },
    );
  }
  if (!change.ok) {
    return NextResponse.json(materialChangeGuardErrorBody(change), {
      status: change.status,
    });
  }
  const updated = change.result;

  console.info("[speaker-mapping][api] save_completed", {
    sessionId,
    transcriptId: updated.id,
    savedMappingKeys: Object.keys(
      ((updated.speakerMapping as SpeakerMapping | null) ?? {}) as Record<string, string | null>,
    ),
    resultingSpeakerMappingStatus: updated.speakerMappingStatus,
    confirm,
  });

  const publication = parseTranscriptEnhancementPublication(updated.processingMetadata);
  const currentRetranscribeCount = updated.retranscribeCount ?? 0;
  return NextResponse.json({
    transcript: {
      id: updated.id,
      source: updated.source,
      text: updated.text,
      diarizedText: updated.diarizedText,
      language: updated.language,
      transcriptionModel: updated.transcriptionModel,
      hasSpeakerDiarization: updated.hasSpeakerDiarization,
      speakerMapping: (updated.speakerMapping as SpeakerMapping | null) ?? null,
      speakerMappingStatus: updated.speakerMappingStatus,
      speakerMappingConfirmedAt: updated.speakerMappingConfirmedAt?.toISOString() ?? null,
      retranscribeCount: currentRetranscribeCount,
      updatedAt: updated.updatedAt.toISOString(),
      segments: updated.segments.map((segment) => ({
        id: segment.id,
        speakerLabel: segment.speakerLabel,
        mappedParticipantId: segment.mappedParticipantId,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: segment.text,
        orderIndex: segment.orderIndex,
        mappingSource: segment.mappingSource ?? null,
        mappingLocked: segment.mappingLocked,
        mappingConfidence: segment.mappingConfidence ?? null,
        enhancementProvenance: resolveSegmentEnhancementProvenance({
          publication,
          currentRetranscribeCount,
          orderIndex: segment.orderIndex,
          publishedText: segment.text,
          rawText: segment.qualityText,
        }),
      })),
    },
    confirmed: confirm,
    publicationRevoked: change.publicationRevoked,
  });
}
