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
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Stable, bounded client-facing failure contract. Never an internal message. */
export const ADMIN_HEALTH_ERROR_CODE = "ADMIN_DIAGNOSTICS_UNAVAILABLE";
export const ADMIN_HEALTH_ERROR_MESSAGE =
  "Unable to load admin diagnostics.";

const emptyUsage = {
  livekitRecordingMinutes: 0,
  voximplantConferenceMinutes: 0,
  openAiTranscriptionMinutes: 0,
  openAiTranscriptionBytes: 0,
  yandexSpeechKitMinutes: 0,
  yandexAiAnalysisRuns: 0,
  storageUploadedBytes: 0,
  storageDownloadedBytes: 0,
  recordingsCreated: 0,
};

function staticAdminHealthFallback() {
  return {
    config: {
      envGroups: [
        {
          group: "Diagnostics",
          items: [
            {
              key: "ADMIN_HEALTH",
              area: "Diagnostics",
              status: "invalid",
              valueSource: "derived",
              configured: false,
              isSecret: false,
              value: null,
              applicable: true,
              required: false,
              consumer: "app/api/admin/health/route.ts",
              explanation: ADMIN_HEALTH_ERROR_CODE,
            },
          ],
        },
      ],
    },
    voximplantRecordingWebhook: buildVoximplantRecordingWebhookUrlStateWithoutDb(),
    hasRecentServiceErrors: false,
    recentEvents: [],
    usage: emptyUsage,
    errorCode: ADMIN_HEALTH_ERROR_CODE,
    error: ADMIN_HEALTH_ERROR_MESSAGE,
  };
}

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
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Only the exception class reaches the server log: internal messages can
    // embed connection strings, Prisma arguments, and environment values.
    console.error(
      JSON.stringify({
        route: "GET /api/admin/health",
        errorCode: ADMIN_HEALTH_ERROR_CODE,
        errorClass:
          error && typeof error === "object" && "name" in error
            ? String((error as { name: unknown }).name)
                .replace(/[^A-Za-z0-9_]/g, "")
                .slice(0, 60)
            : typeof error,
      }),
    );

    return NextResponse.json(
      staticAdminHealthFallback(),
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
