import { NextResponse } from "next/server";

import {
  getEnvironmentConfigStatus,
} from "@/lib/services/admin-health";
import { hasRecentCriticalServiceErrors } from "@/lib/services/external-service-events";
import { getMonthlyUsageSummary } from "@/lib/services/usage-counters";
import { prisma } from "@/lib/prisma";
import { apiRequireAdminUser } from "@/lib/auth/api-guards";
import { getVoximplantRecordingWebhookUrlState, buildVoximplantRecordingWebhookUrlStateWithoutDb } from "@/lib/voximplant/recording-webhook-url";

export const runtime = "nodejs";

const emptyUsage = {
  livekitRecordingMinutes: 0,
  openAiTranscriptionMinutes: 0,
  openAiTranscriptionBytes: 0,
  storageUploadedBytes: 0,
  storageDownloadedBytes: 0,
  recordingsCreated: 0,
};

export async function GET() {
  const { response: authError } = await apiRequireAdminUser();
  if (authError) return authError;

  try {

    const [hasRecentErrors, recentEvents, usage, voximplantRecordingWebhook] =
      await Promise.all([
      hasRecentCriticalServiceErrors(24).catch(() => false),
      prisma.externalServiceEvent
        .findMany({
          orderBy: { createdAt: "desc" },
          take: 50,
        })
        .catch(() => []),
      getMonthlyUsageSummary().catch(() => emptyUsage),
      getVoximplantRecordingWebhookUrlState().catch(() =>
        buildVoximplantRecordingWebhookUrlStateWithoutDb(),
      ),
    ]);

    return NextResponse.json({
      config: getEnvironmentConfigStatus(),
      voximplantRecordingWebhook,
      hasRecentServiceErrors: hasRecentErrors,
      recentEvents: recentEvents.map((event) => ({
        id: event.id,
        service: event.service,
        severity: event.severity,
        errorCode: event.errorCode,
        title: event.title,
        message: event.message,
        sessionId: event.sessionId,
        recordingId: event.recordingId,
        createdAt: event.createdAt.toISOString(),
        resolvedAt: event.resolvedAt?.toISOString() ?? null,
      })),
      usage,
    });
  } catch (error) {
    console.error("[GET /api/admin/health]", error);

    return NextResponse.json(
      {
        config: getEnvironmentConfigStatus(),
        voximplantRecordingWebhook: buildVoximplantRecordingWebhookUrlStateWithoutDb(),
        hasRecentServiceErrors: false,
        recentEvents: [],
        usage: emptyUsage,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load admin diagnostics.",
      },
      { status: 200 },
    );
  }
}
