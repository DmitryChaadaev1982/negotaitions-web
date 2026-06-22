import { NextResponse } from "next/server";

import { getDemoFacilitator } from "@/lib/demo-user";
import {
  getEnvironmentConfigStatus,
} from "@/lib/services/admin-health";
import { hasRecentCriticalServiceErrors } from "@/lib/services/external-service-events";
import { getMonthlyUsageSummary } from "@/lib/services/usage-counters";
import { prisma } from "@/lib/prisma";

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
  try {
    await getDemoFacilitator();

    const [hasRecentErrors, recentEvents, usage] = await Promise.all([
      hasRecentCriticalServiceErrors(24).catch(() => false),
      prisma.externalServiceEvent
        .findMany({
          orderBy: { createdAt: "desc" },
          take: 50,
        })
        .catch(() => []),
      getMonthlyUsageSummary().catch(() => emptyUsage),
    ]);

    return NextResponse.json({
      config: getEnvironmentConfigStatus(),
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
