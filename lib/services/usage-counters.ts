import { ExternalService } from "@/app/generated/prisma/client";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export function getCurrentMonthPeriod() {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}

async function incrementUsageCounter(
  service: ExternalService,
  metric: string,
  amount: number,
  unit: string,
  metadata?: Record<string, unknown>,
) {
  const { periodStart, periodEnd } = getCurrentMonthPeriod();

  const existing = await prisma.usageCounter.findFirst({
    where: {
      service,
      metric,
      periodStart,
    },
  });

  if (existing) {
    return prisma.usageCounter.update({
      where: { id: existing.id },
      data: {
        value: existing.value + amount,
        metadata: (metadata ?? existing.metadata ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
      },
    });
  }

  return prisma.usageCounter.create({
    data: {
      service,
      metric,
      periodStart,
      periodEnd,
      value: amount,
      unit,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function trackLiveKitRecordingMinutes(
  startedAt: Date,
  endedAt: Date,
  sessionId?: string,
) {
  const minutes = Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 60000);
  if (minutes <= 0) {
    return;
  }

  await incrementUsageCounter(
    ExternalService.LIVEKIT,
    "egress_recording_minutes",
    minutes,
    "minutes",
    sessionId ? { sessionId } : undefined,
  );
}

export async function trackOpenAiTranscriptionMinutes(
  minutes: number,
  sessionId?: string,
) {
  if (minutes <= 0) {
    return;
  }

  await incrementUsageCounter(
    ExternalService.OPENAI,
    "transcription_minutes",
    minutes,
    "minutes",
    sessionId ? { sessionId } : undefined,
  );
}

export async function trackOpenAiTranscriptionBytes(
  bytes: number,
  sessionId?: string,
) {
  if (bytes <= 0) {
    return;
  }

  await incrementUsageCounter(
    ExternalService.OPENAI,
    "transcription_bytes",
    bytes,
    "bytes",
    sessionId ? { sessionId } : undefined,
  );
}

export async function trackStorageUploadedBytes(bytes: number, fileKey?: string) {
  if (bytes <= 0) {
    return;
  }

  await incrementUsageCounter(
    ExternalService.YANDEX_OBJECT_STORAGE,
    "uploaded_bytes",
    bytes,
    "bytes",
    fileKey ? { fileKey } : undefined,
  );
}

export async function trackStorageDownloadedBytes(bytes: number, fileKey?: string) {
  if (bytes <= 0) {
    return;
  }

  await incrementUsageCounter(
    ExternalService.YANDEX_OBJECT_STORAGE,
    "downloaded_bytes",
    bytes,
    "bytes",
    fileKey ? { fileKey } : undefined,
  );
}

export async function trackStorageObjectWritten() {
  await incrementUsageCounter(
    ExternalService.YANDEX_OBJECT_STORAGE,
    "objects_written",
    1,
    "count",
  );
}

export async function trackRecordingCreated() {
  await incrementUsageCounter(ExternalService.APP, "recordings_created", 1, "count");
}

export async function getMonthlyUsageSummary() {
  const { periodStart } = getCurrentMonthPeriod();

  const counters = await prisma.usageCounter.findMany({
    where: { periodStart },
    orderBy: [{ service: "asc" }, { metric: "asc" }],
  });

  const byMetric = (service: ExternalService, metric: string) =>
    counters.find((counter) => counter.service === service && counter.metric === metric)
      ?.value ?? 0;

  return {
    livekitRecordingMinutes: byMetric(ExternalService.LIVEKIT, "egress_recording_minutes"),
    openAiTranscriptionMinutes: byMetric(ExternalService.OPENAI, "transcription_minutes"),
    openAiTranscriptionBytes: byMetric(ExternalService.OPENAI, "transcription_bytes"),
    storageUploadedBytes: byMetric(
      ExternalService.YANDEX_OBJECT_STORAGE,
      "uploaded_bytes",
    ),
    storageDownloadedBytes: byMetric(
      ExternalService.YANDEX_OBJECT_STORAGE,
      "downloaded_bytes",
    ),
    recordingsCreated: byMetric(ExternalService.APP, "recordings_created"),
  };
}
