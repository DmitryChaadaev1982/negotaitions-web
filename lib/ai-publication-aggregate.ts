import { ParticipantType } from "@/app/generated/prisma/client";

type AiPublicationAggregateInput = {
  aiStatus: string | null;
  aiVisibility: string | null;
  sharedAnalysisJson: unknown | null;
  participants: Array<{
    id: string;
    userId: string | null;
    displayName: string;
    type: ParticipantType;
  }>;
};

export type AiPublicationAggregateStatus = "none" | "partial" | "full";

export type AiPublicationAggregate = {
  status: AiPublicationAggregateStatus;
  requiredRecipientCount: number;
  publishedRecipientCount: number;
};

type SharedAnalysisParticipantFeedback = {
  sessionParticipantId?: unknown;
  participantId?: unknown;
  recipientId?: unknown;
  publicationRecipientId?: unknown;
  userId?: unknown;
  recipientUserId?: unknown;
  participantName?: unknown;
  displayName?: unknown;
  name?: unknown;
};

type SharedAnalysisShape = {
  participantPersonalFeedback?: unknown;
};

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type PublishedRecipientReference = {
  sessionParticipantId: string | null;
  userId: string | null;
  recipientId: string | null;
  normalizedName: string | null;
};

function parsePublishedRecipientReferences(
  sharedAnalysisJson: unknown,
): PublishedRecipientReference[] {
  if (!sharedAnalysisJson || typeof sharedAnalysisJson !== "object") {
    return [];
  }

  const shared = sharedAnalysisJson as SharedAnalysisShape;
  if (!Array.isArray(shared.participantPersonalFeedback)) {
    return [];
  }

  const references: PublishedRecipientReference[] = [];
  for (const row of shared.participantPersonalFeedback) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const feedback = row as SharedAnalysisParticipantFeedback;
    const participantName =
      readString(feedback.participantName) ??
      readString(feedback.displayName) ??
      readString(feedback.name);
    const sessionParticipantId =
      readString(feedback.sessionParticipantId) ??
      readString(feedback.participantId);
    const userId =
      readString(feedback.userId) ?? readString(feedback.recipientUserId);
    const recipientId =
      readString(feedback.recipientId) ??
      readString(feedback.publicationRecipientId);

    references.push({
      sessionParticipantId,
      userId,
      recipientId,
      normalizedName: participantName ? normalizeName(participantName) : null,
    });
  }

  return references;
}

export function aggregateAiPublicationStatus(
  input: AiPublicationAggregateInput,
): AiPublicationAggregate {
  if (input.aiStatus !== "COMPLETED") {
    return { status: "none", requiredRecipientCount: 0, publishedRecipientCount: 0 };
  }

  const requiredRecipients = new Map<
    string,
    {
      id: string;
      userId: string | null;
      normalizedName: string;
    }
  >();
  const requiredByUserId = new Map<string, string[]>();
  const requiredByName = new Map<string, string[]>();

  for (const participant of input.participants) {
    if (participant.type !== ParticipantType.PARTICIPANT) {
      continue;
    }

    const normalizedName = normalizeName(participant.displayName);
    if (!participant.id || normalizedName.length === 0) {
      continue;
    }

    requiredRecipients.set(participant.id, {
      id: participant.id,
      userId: participant.userId,
      normalizedName,
    });

    if (participant.userId) {
      const existing = requiredByUserId.get(participant.userId) ?? [];
      existing.push(participant.id);
      requiredByUserId.set(participant.userId, existing);
    }
    const existingByName = requiredByName.get(normalizedName) ?? [];
    existingByName.push(participant.id);
    requiredByName.set(normalizedName, existingByName);
  }

  const requiredRecipientCount = requiredRecipients.size;
  if (requiredRecipientCount === 0) {
    return { status: "none", requiredRecipientCount: 0, publishedRecipientCount: 0 };
  }

  if (input.aiVisibility !== "SHARED_WITH_SESSION") {
    return {
      status: "none",
      requiredRecipientCount,
      publishedRecipientCount: 0,
    };
  }

  const publishedRefs = parsePublishedRecipientReferences(input.sharedAnalysisJson);
  const publishedRequiredRecipientIds = new Set<string>();

  for (const publishedRef of publishedRefs) {
    if (
      publishedRef.sessionParticipantId &&
      requiredRecipients.has(publishedRef.sessionParticipantId)
    ) {
      publishedRequiredRecipientIds.add(publishedRef.sessionParticipantId);
      continue;
    }

    // Legacy/alternate payloads might expose a generic recipientId. We treat it as
    // stable only when it maps directly to an existing session participant id.
    if (publishedRef.recipientId && requiredRecipients.has(publishedRef.recipientId)) {
      publishedRequiredRecipientIds.add(publishedRef.recipientId);
      continue;
    }

    if (publishedRef.userId) {
      const userIdMatches = requiredByUserId.get(publishedRef.userId) ?? [];
      if (userIdMatches.length === 1) {
        publishedRequiredRecipientIds.add(userIdMatches[0]!);
        continue;
      }
    }

    // Conservative backward-compatibility for legacy name-only payloads:
    // count a name match only when that normalized name is unique among required
    // recipients in the current session.
    if (publishedRef.normalizedName) {
      const nameMatches = requiredByName.get(publishedRef.normalizedName) ?? [];
      if (nameMatches.length === 1) {
        publishedRequiredRecipientIds.add(nameMatches[0]!);
      }
    }
  }

  const publishedCount = publishedRequiredRecipientIds.size;
  if (publishedCount <= 0) {
    return {
      status: "none",
      requiredRecipientCount,
      publishedRecipientCount: 0,
    };
  }
  if (publishedCount < requiredRecipientCount) {
    return {
      status: "partial",
      requiredRecipientCount,
      publishedRecipientCount: publishedCount,
    };
  }

  return {
    status: "full",
    requiredRecipientCount,
    publishedRecipientCount: publishedCount,
  };
}
