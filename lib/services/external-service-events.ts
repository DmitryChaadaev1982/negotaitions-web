import type { Prisma } from "@/app/generated/prisma/client";
import {
  ExternalService,
  ExternalServiceEventSeverity,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  classifyExternalServiceError,
  type ClassifiedError,
} from "@/lib/services/error-classifier";

export type LogExternalServiceEventInput = {
  service: ExternalService;
  severity?: ExternalServiceEventSeverity;
  errorCode?: ClassifiedError["errorCode"];
  title: string;
  message: string;
  rawError?: unknown;
  sessionId?: string;
  recordingId?: string;
  requestId?: string;
  context?: string;
};

export async function logExternalServiceEvent(input: LogExternalServiceEventInput) {
  console.error(
    `[ExternalServiceEvent] ${input.service} ${input.severity ?? ExternalServiceEventSeverity.ERROR}: ${input.title} — ${input.message}`,
    input.rawError ?? "",
  );

  return prisma.externalServiceEvent.create({
    data: {
      service: input.service,
      severity: input.severity ?? ExternalServiceEventSeverity.ERROR,
      errorCode: input.errorCode,
      title: input.title,
      message: input.message,
      rawError: input.rawError as Prisma.InputJsonValue | undefined,
      sessionId: input.sessionId,
      recordingId: input.recordingId,
      requestId: input.requestId,
    },
  });
}

export async function logClassifiedExternalServiceError(
  classified: ClassifiedError,
  options?: {
    sessionId?: string;
    recordingId?: string;
    requestId?: string;
  },
) {
  return logExternalServiceEvent({
    service: classified.service,
    severity: classified.severity,
    errorCode: classified.errorCode,
    title: classified.title,
    message: classified.message,
    rawError: classified.rawError,
    sessionId: options?.sessionId,
    recordingId: options?.recordingId,
    requestId: options?.requestId,
  });
}

export async function handleExternalServiceFailure(
  service: ExternalService,
  error: unknown,
  options?: {
    sessionId?: string;
    recordingId?: string;
    requestId?: string;
    context?: string;
  },
) {
  const classified = classifyExternalServiceError(
    service,
    error,
    options?.context,
  );

  await logClassifiedExternalServiceError(classified, options);

  return classified;
}

export async function hasRecentCriticalServiceErrors(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const count = await prisma.externalServiceEvent.count({
    where: {
      resolvedAt: null,
      severity: { in: [ExternalServiceEventSeverity.ERROR, ExternalServiceEventSeverity.CRITICAL] },
      createdAt: { gte: since },
    },
  });

  return count > 0;
}
