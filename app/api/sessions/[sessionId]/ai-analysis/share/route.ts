import { NextResponse } from "next/server";

import {
  AiAnalysisStatus,
  ParticipantType,
  Prisma,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import type { NegotiationAnalysisOutput } from "@/lib/ai/negotiation-analysis";
import { sanitizeSharedAiAnalysisForParticipant } from "@/lib/privacy/serializers";
import { evaluateAiAnalysisCurrentness } from "@/lib/ai/analysis-currentness";
import { computeCurrentMaterialInputFingerprint } from "@/lib/ai/session-analysis-context";
import {
  historicalSessionRoomEntryWhere,
  selectPublicationRecipients,
} from "@/lib/ai-publication";
import {
  isAiPublicationSerializationConflict,
  retryAiPublicationTransaction,
} from "@/lib/ai-publication-transaction";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

/**
 * Sanitize the full analysis for sharing with session participants.
 *
 * Strips all fields that could reveal private role data:
 *   - roleObjectivesAnalysis (contains private objectives/fallback analysis)
 *   - rawPrompt (raw AI prompt including private role instructions)
 *   - analysisContext (raw context including all role briefings)
 *   - facilitatorNotes (facilitator-only notes)
 *
 * participantPersonalFeedback is retained; it is filtered per-participant
 * at delivery time in the materials/status API.
 */
function sanitizeAnalysisForParticipants(
  analysis: NegotiationAnalysisOutput,
): NegotiationAnalysisOutput {
  return sanitizeSharedAiAnalysisForParticipant(
    analysis,
  ) as NegotiationAnalysisOutput;
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: {
    joinToken?: string;
    participantId?: string;
    aiAnalysisId?: string;
    // Caller must explicitly confirm share-debrief consent in UI.
    shareDebriefConfirmed?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { joinToken, participantId, aiAnalysisId, shareDebriefConfirmed } = body;

  if (!shareDebriefConfirmed) {
    return NextResponse.json(
      { error: "shareDebriefConfirmed is required to share AI analysis." },
      { status: 400 },
    );
  }

  if (!joinToken && !participantId) {
    return NextResponse.json({ error: "joinToken or participantId is required." }, { status: 400 });
  }

  let participant: Awaited<ReturnType<typeof resolveRoomParticipantFromParsedBody>> | null = null;
  let isEventHostOwner = false;
  let adminUser = false;

  if (participantId) {
    // Account mode: verify cookie ownership
    const user = await getOptionalCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    adminUser = isAdmin(user);
    // Check if user is event host (can manage even without FACILITATOR participant type)
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { event: { select: { hostUserId: true } } },
    });
    isEventHostOwner = session?.event?.hostUserId === user.id;
  }

  participant = await resolveRoomParticipantFromParsedBody(
    { joinToken: joinToken ?? null, participantId: participantId ?? null },
    sessionId,
  );

  if (!participant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const isFacilitatorType = participant.type === ParticipantType.FACILITATOR;
  if (!isFacilitatorType && !isEventHostOwner && !adminUser) {
    return NextResponse.json(
      { error: "Only facilitators can share AI analysis." },
      { status: 403 },
    );
  }

  let publication;
  try {
    publication = await retryAiPublicationTransaction(() => prisma.$transaction(
    async (tx) => {
      // Serializes Publish against re-analysis, Unshare, and late-entry grant
      // materialization before historical room-entry eligibility is read.
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM "AiAnalysis"
        WHERE "sessionId" = ${sessionId}
        FOR UPDATE
      `);
      if (!locked[0]) {
        return { state: "analysis_not_found" as const };
      }

      const aiAnalysis = await tx.aiAnalysis.findUnique({
        where: { id: locked[0].id },
        select: {
          id: true,
          status: true,
          transcriptId: true,
          transcriptRetranscribeCount: true,
          inputFingerprint: true,
          analysisVersion: true,
          publicationEpoch: true,
          analysisJson: true,
          executiveSummary: true,
          publications: {
            where: { revokedAt: null },
            select: {
              id: true,
              analysisVersion: true,
              publicationEpoch: true,
              publishedAt: true,
            },
          },
        },
      });
      if (!aiAnalysis) {
        return { state: "analysis_not_found" as const };
      }
      if (aiAnalysisId && aiAnalysis.id !== aiAnalysisId) {
        return { state: "analysis_id_mismatch" as const };
      }
      if (aiAnalysis.status !== AiAnalysisStatus.COMPLETED) {
        return { state: "analysis_not_completed" as const };
      }
      const currentTranscript = await tx.transcript.findUnique({
        where: { sessionId },
        select: { id: true, retranscribeCount: true },
      });
      const currentFingerprint = await computeCurrentMaterialInputFingerprint(
        sessionId,
      );
      const currentness = evaluateAiAnalysisCurrentness({
        analysis: aiAnalysis,
        currentFingerprint,
        transcriptId: currentTranscript?.id,
        transcriptRetranscribeCount: currentTranscript?.retranscribeCount,
      });
      if (!currentness.current) {
        return { state: "analysis_outdated" as const };
      }

      // One logical timestamp fences the snapshot and each resulting grant.
      // Recipient eligibility is historical room entry, not active presence.
      const publishedAt = new Date();
      const enteredConnections = await tx.sessionRoomConnection.findMany({
        where: historicalSessionRoomEntryWhere({ sessionId }),
        select: { userId: true },
        distinct: ["userId"],
      });
      const enteredUserIds = enteredConnections.map((connection) => connection.userId);
      const candidates =
        enteredUserIds.length === 0
          ? []
          : await tx.sessionParticipant.findMany({
              where: {
                sessionId,
                userId: { in: enteredUserIds },
                type: { in: [ParticipantType.PARTICIPANT, ParticipantType.OBSERVER] },
              },
              select: { id: true, userId: true, type: true },
            });
      const recipients = selectPublicationRecipients(enteredConnections, candidates);

      const currentPublication = aiAnalysis.publications.find(
        (candidate) => candidate.analysisVersion === aiAnalysis.analysisVersion,
      );

      const fullAnalysis = aiAnalysis.analysisJson as NegotiationAnalysisOutput | null;
      // Key presence itself is a privacy failure; forbidden keys must be removed,
      // never re-added as null/empty placeholders.
      const sanitized = fullAnalysis ? sanitizeAnalysisForParticipants(fullAnalysis) : null;

      const targetPublication = currentPublication
        ? currentPublication
        : await (async () => {
            // A new analysis version or post-unshare Publish starts a fresh
            // epoch. It never revives grants from a prior epoch.
            await tx.aiAnalysisPublication.updateMany({
              where: { aiAnalysisId: aiAnalysis.id, revokedAt: null },
              data: { revokedAt: publishedAt },
            });
            const epoch = aiAnalysis.publicationEpoch + 1;
            await tx.aiAnalysis.update({
              where: { id: aiAnalysis.id },
              data: { publicationEpoch: epoch },
            });
            return tx.aiAnalysisPublication.create({
              data: {
                aiAnalysisId: aiAnalysis.id,
                analysisVersion: aiAnalysis.analysisVersion,
                publicationEpoch: epoch,
                sharedAnalysisJson: sanitized ?? Prisma.JsonNull,
                sharedExecutiveSummary: aiAnalysis.executiveSummary,
                publishedAt,
                publishedBy: participant.displayName,
              },
              select: {
                id: true,
                analysisVersion: true,
                publicationEpoch: true,
                publishedAt: true,
              },
            });
          })();

      for (const recipient of recipients) {
        await tx.aiAnalysisPublicationGrant.upsert({
          where: {
            publicationId_sessionParticipantId: {
              publicationId: targetPublication.id,
              sessionParticipantId: recipient.sessionParticipantId,
            },
          },
          create: {
            publicationId: targetPublication.id,
            sessionParticipantId: recipient.sessionParticipantId,
            userId: recipient.userId,
            projection: recipient.projection,
            grantedAt: publishedAt,
          },
          // Keep the original projection as the maximum authorized view. A
          // later membership-role change cannot upgrade an existing grant.
          update: { revokedAt: null },
        });
      }

      const updated = await tx.aiAnalysis.update({
        where: { id: aiAnalysis.id },
        data: {
          visibility: "SHARED_WITH_SESSION",
          sharedAnalysisJson: sanitized ?? Prisma.JsonNull,
          sharedExecutiveSummary: aiAnalysis.executiveSummary,
          sharedAt: targetPublication.publishedAt,
          sharedBy: participant.displayName,
          unsharedAt: null,
        },
        select: {
          id: true,
          visibility: true,
          sharedAt: true,
          sharedBy: true,
        },
      });

      return {
        state: "published" as const,
        updated,
        publicationEpoch: targetPublication.publicationEpoch,
        recipientCount: recipients.length,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ));
  } catch (error) {
    if (isAiPublicationSerializationConflict(error)) {
      return NextResponse.json(
        { error: "AI analysis publication is busy. Please retry." },
        { status: 409 },
      );
    }
    throw error;
  }

  if (publication.state === "analysis_not_found") {
    return NextResponse.json({ error: "AI analysis not found." }, { status: 404 });
  }
  if (publication.state === "analysis_id_mismatch") {
    return NextResponse.json({ error: "AI analysis ID mismatch." }, { status: 400 });
  }
  if (publication.state === "analysis_not_completed") {
    return NextResponse.json(
      { error: "AI analysis must be completed before sharing." },
      { status: 409 },
    );
  }
  if (publication.state === "analysis_outdated") {
    return NextResponse.json(
      { error: "AI analysis is outdated and must be regenerated before sharing." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    visibility: publication.updated.visibility,
    sharedAt: publication.updated.sharedAt?.toISOString() ?? null,
    sharedBy: publication.updated.sharedBy,
    publicationEpoch: publication.publicationEpoch,
    recipientCount: publication.recipientCount,
  });
}
