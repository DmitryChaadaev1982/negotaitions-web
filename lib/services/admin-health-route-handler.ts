import { NextResponse } from "next/server";

export const ADMIN_HEALTH_ERROR_CODE = "ADMIN_HEALTH_UNAVAILABLE";
export const RUNTIME_CONFIGURATION_ERROR_CODE =
  "RUNTIME_CONFIGURATION_UNAVAILABLE";

type AdminHealthUsage = Readonly<{
  livekitRecordingMinutes: number;
  voximplantConferenceMinutes: number;
  openAiTranscriptionMinutes: number;
  openAiTranscriptionBytes: number;
  yandexSpeechKitMinutes: number;
  yandexAiAnalysisRuns: number;
  storageUploadedBytes: number;
  storageDownloadedBytes: number;
  recordingsCreated: number;
}>;

const EMPTY_USAGE: AdminHealthUsage = Object.freeze({
  livekitRecordingMinutes: 0,
  voximplantConferenceMinutes: 0,
  openAiTranscriptionMinutes: 0,
  openAiTranscriptionBytes: 0,
  yandexSpeechKitMinutes: 0,
  yandexAiAnalysisRuns: 0,
  storageUploadedBytes: 0,
  storageDownloadedBytes: 0,
  recordingsCreated: 0,
});

export const ADMIN_HEALTH_EMERGENCY_RESPONSE = Object.freeze({
  config: Object.freeze({
    envGroups: Object.freeze([
      Object.freeze({
        group: "Diagnostics",
        items: Object.freeze([
          Object.freeze({
            key: "RUNTIME_CONFIGURATION",
            area: "Diagnostics",
            status: "invalid",
            valueSource: "derived",
            configured: false,
            isSecret: false,
            value: null,
            applicable: true,
            required: false,
            consumer: "app/api/admin/health/route.ts",
            explanation: RUNTIME_CONFIGURATION_ERROR_CODE,
          }),
        ]),
      }),
    ]),
  }),
  hasRecentServiceErrors: false,
  recentEvents: Object.freeze([]),
  usage: EMPTY_USAGE,
  errorCode: ADMIN_HEALTH_ERROR_CODE,
  error: ADMIN_HEALTH_ERROR_CODE,
});

type AdminHealthEvent = {
  id: string;
  service: string;
  severity: string;
  errorCode: string | null;
  title: string;
  message: string;
  sessionId: string | null;
  recordingId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

export type AdminHealthDependencies = {
  authorize: () => Promise<{ response: Response | null; user: unknown }>;
  hasRecentErrors: (hours: number) => Promise<boolean>;
  findRecentEvents: () => Promise<AdminHealthEvent[]>;
  getUsage: () => Promise<AdminHealthUsage>;
  getWebhookState: () => Promise<unknown>;
  getWebhookFallback: () => unknown;
  getConfig: () => unknown;
};

export function createAdminHealthGet(dependencies: AdminHealthDependencies) {
  return async function adminHealthGet() {
    const { response: authError } = await dependencies.authorize();
    if (authError) return authError;

    try {
      // Fail before starting other resolvers when configuration assembly fails.
      const config = dependencies.getConfig();
      const [hasRecentErrors, recentEvents, usage, voximplantRecordingWebhook] =
        await Promise.all([
          dependencies.hasRecentErrors(24).catch(() => false),
          dependencies.findRecentEvents().catch(() => []),
          dependencies.getUsage().catch(() => EMPTY_USAGE),
          dependencies
            .getWebhookState()
            .catch(() => dependencies.getWebhookFallback()),
        ]);

      return NextResponse.json(
        {
          config,
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
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          eventCode: "admin_health_emergency_response",
          route: "GET /api/admin/health",
          errorCategory: error instanceof Error ? "error" : "non_error",
        }),
      );

      return NextResponse.json(ADMIN_HEALTH_EMERGENCY_RESPONSE, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
  };
}
