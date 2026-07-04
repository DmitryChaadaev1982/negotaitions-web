"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AdminVoximplantWebhookOverridePanel } from "@/components/admin-voximplant-webhook-override-panel";
import { Card, CardContent, CardHeader } from "@/components/card";
import { SecondaryButton } from "@/components/ui/buttons";
import { useI18n } from "@/lib/i18n/useI18n";
import type { VoximplantRecordingWebhookUrlState } from "@/lib/voximplant/recording-webhook-url";

type HealthData = {
  config: {
    videoProvider?: "livekit" | "voximplant";
    videoProviderEnvValid?: boolean;
    aiAnalysisProvider?: "openai" | "yandex";
    transcriptionProvider?: "openai" | "yandex_speechkit";
    aiAnalysisProviderEnvValid?: boolean;
    transcriptionProviderEnvValid?: boolean;
    livekitUrl: boolean;
    livekitApiKey: boolean;
    livekitApiSecret: boolean;
    s3Bucket: boolean;
    s3Region: boolean;
    s3Endpoint: boolean;
    s3AccessKeyId: boolean;
    s3SecretAccessKey: boolean;
    openAiApiKey: boolean;
    yandexFolderId?: boolean;
    yandexApiKey?: boolean;
    yandexAiModel?: boolean;
    yandexSpeechKitModel?: boolean;
    yandexSpeechKitModelValue?: string;
    yandexSpeechKitLanguageValue?: string;
    yandexSpeechKitNormalizationEnabled?: boolean;
    yandexSpeechKitLiteratureTextEnabled?: boolean;
    yandexSpeechKitSpeakerLabelingEnabled?: boolean;
    yandexTranscriptEnhancementEnabled?: boolean;
    yandexSpeechKitRequiredKeysPresent?: boolean;
    voximplantRecordingEnabled?: boolean;
    voximplant?: {
      accountName: boolean;
      applicationName: boolean;
      userDomain: boolean;
      scenarioName: boolean;
      ruleName: boolean;
      recordingEnabled: boolean;
      recordingAudioOnly: boolean;
      recordingAudioMode: string;
      recordingStorage: boolean;
      managementApiConfigured: boolean;
      managementAccountId: {
        status:
          | "configured_via_env"
          | "configured_via_key_file"
          | "missing"
          | "invalid_key_file";
        error?: string;
      };
      managementApplicationId?: {
        status:
          | "configured_via_env"
          | "configured_via_key_file"
          | "missing"
          | "invalid_key_file";
        error?: string;
      };
      apiKeyPath: boolean;
      recordingWebhookSecret: boolean;
      recordingWebhookBaseUrl: boolean;
      recordingWebhookBaseUrlValue: string | null;
      recordingWebhookOverrideEnabled: boolean;
      recordingWebhookOverrideEnabledRaw?: string | null;
      nodeEnv?: string;
    };
    ffmpeg?: {
      available: boolean;
      path: string | null;
      source: "env" | "system" | "static" | null;
    };
    envGroups?: Array<{
      group: string;
      items: Array<{
        key: string;
        configured: boolean;
        isSecret: boolean;
        value: string | null;
      }>;
    }>;
  };
  voximplantRecordingWebhook?: VoximplantRecordingWebhookUrlState;
  hasRecentServiceErrors: boolean;
  recentEvents: Array<{
    id: string;
    service: string;
    severity: string;
    errorCode: string | null;
    title: string;
    message: string;
    sessionId: string | null;
    recordingId: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }>;
  usage: {
    livekitRecordingMinutes: number;
    voximplantConferenceMinutes: number;
    openAiTranscriptionMinutes: number;
    openAiTranscriptionBytes: number;
    yandexSpeechKitMinutes: number;
    yandexAiAnalysisRuns: number;
    storageUploadedBytes: number;
    storageDownloadedBytes: number;
    recordingsCreated: number;
  };
  error?: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function EnvValueRow({
  label,
  configured,
  value,
}: {
  label: string;
  configured: boolean;
  value: string | null;
}) {
  const { t } = useI18n();

  return (
    <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-slate-300">{label}</span>
        <span
          className={
            configured
              ? "text-xs font-medium text-emerald-400"
              : "text-xs font-medium text-amber-400"
          }
        >
          {configured ? t("admin.configured") : t("admin.missing")}
        </span>
      </div>
      <p className="mt-2 break-all font-mono text-xs text-slate-400">
        {value ?? "—"}
      </p>
    </div>
  );
}

type AdminDiagnosticsViewProps = {
  mode?: "all" | "counters" | "log";
};

export function AdminDiagnosticsView({ mode = "all" }: AdminDiagnosticsViewProps) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [checkRunning, setCheckRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    const response = await fetch("/api/admin/health");
    const text = await response.text();

    if (!text) {
      throw new Error("Empty response from server.");
    }

    let payload: HealthData;
    try {
      payload = JSON.parse(text) as HealthData;
    } catch {
      throw new Error("Invalid response from server.");
    }

    if (!response.ok && !payload.config) {
      throw new Error(payload.error ?? "Unable to load admin diagnostics.");
    }

    return payload;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const payload = await loadHealth();
        if (!cancelled) {
          setData(payload);
          setLoadError(payload.error ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load admin diagnostics.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadHealth]);

  const runCheck = async (endpoint: string) => {
    setCheckRunning(true);
    setCheckMessage(t("admin.runningCheck"));

    try {
      const response = await fetch(endpoint, { method: "POST" });
      const payload = (await response.json()) as {
        ok: boolean;
        message: string;
        path?: string;
        source?: "env" | "system" | "static" | null;
      };
      const details = payload.path
        ? ` (${payload.path}${payload.source ? `, ${payload.source}` : ""})`
        : "";
      setCheckMessage(
        `${t("admin.checkResult")}: ${payload.ok ? t("admin.healthy") : t("admin.failed")} — ${payload.message}${details}`,
      );
      const refreshed = await loadHealth();
      setData(refreshed);
    } catch {
      setCheckMessage(`${t("admin.checkResult")}: ${t("admin.failed")}`);
    } finally {
      setCheckRunning(false);
    }
  };

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(iso));

  const showDiagnostics = mode === "all";
  const showCounters = mode === "counters";
  const showLog = mode === "log";
  const adminNavClassName = (active: boolean) =>
    active
      ? "rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200"
      : "rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100";

  return (
    <div className="space-y-8">
      {/* Admin private-data warning label */}
      <div
        data-testid="admin-private-data-warning"
        className="rounded-lg border border-amber-500/30 bg-amber-900/15 px-4 py-2.5 flex items-center gap-2"
      >
        <span className="text-amber-400 text-sm">⚠️</span>
        <p className="text-xs font-medium text-amber-200">{t("legal.privateRoleDataWarning")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/admin"
          className={adminNavClassName(pathname === "/admin")}
        >
          {t("nav.admin")}
        </Link>
        <Link
          href="/admin/users"
          className={adminNavClassName(pathname.startsWith("/admin/users"))}
        >
          {t("admin.userManagement")}
        </Link>
        <Link
          href="/admin/counters"
          className={adminNavClassName(pathname.startsWith("/admin/counters"))}
        >
          {t("admin.usageCounters")}
        </Link>
        <Link
          href="/admin/log"
          className={adminNavClassName(pathname.startsWith("/admin/log"))}
        >
          {t("admin.recentServiceEvents")}
        </Link>
      </div>

      {showDiagnostics ? (
        <div className="flex flex-wrap gap-2 text-xs">
          <a href="#admin-env-config" className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800/60">
            {t("admin.environmentConfiguration")}
          </a>
          <a href="#admin-voximplant-webhook" className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800/60">
            {t("admin.voximplantRecordingWebhook")}
          </a>
          <a href="#admin-service-checks" className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800/60">
            {t("admin.serviceChecks")}
          </a>
        </div>
      ) : null}

      {loadError ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {loadError}
        </div>
      ) : null}

      {data?.hasRecentServiceErrors ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {t("admin.recentErrorsBanner")}
        </div>
      ) : null}

      {showDiagnostics ? (
      <Card id="admin-env-config">
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("admin.environmentConfiguration")}
          </h2>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading || !data ? (
            <p className="text-sm text-slate-400">{t("common.loading")}...</p>
          ) : (
            <>
              {data.config.envGroups?.map((group, index) => {
                const groupKey = group.group ?? `ungrouped-${index}`;
                if (group.items.length === 0) return null;

                if (group.group === null) {
                  return (
                    <div key={groupKey} className="grid gap-2">
                      {group.items.map((item) => (
                        <EnvValueRow
                          key={`${groupKey}-${item.key}`}
                          label={item.key}
                          configured={item.configured}
                          value={item.value}
                        />
                      ))}
                    </div>
                  );
                }

                return (
                  <details
                    key={groupKey}
                    open
                    className="rounded-xl border border-slate-700/40 bg-slate-900/30"
                  >
                    <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-100">
                      {group.group}
                    </summary>
                    <div className="grid gap-2 border-t border-slate-700/40 px-4 py-3">
                      {group.items.map((item) => (
                        <EnvValueRow
                          key={`${groupKey}-${item.key}`}
                          label={item.key}
                          configured={item.configured}
                          value={item.value}
                        />
                      ))}
                    </div>
                  </details>
                );
              })}
            </>
          )}
        </CardContent>
      </Card>
      ) : null}

      {showDiagnostics && data?.voximplantRecordingWebhook ? (
        <Card id="admin-voximplant-webhook">
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-50">
              {t("admin.voximplantRecordingWebhook")}
            </h2>
          </CardHeader>
          <CardContent>
            <AdminVoximplantWebhookOverridePanel
              initialState={data.voximplantRecordingWebhook}
              onStateChange={(next) => {
                setData((current) =>
                  current
                    ? { ...current, voximplantRecordingWebhook: next }
                    : current,
                );
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {showDiagnostics ? (
      <Card id="admin-service-checks">
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("admin.serviceChecks")}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <SecondaryButton
              disabled={checkRunning}
              onClick={() => void runCheck("/api/admin/check-livekit")}
            >
              {t("admin.checkLiveKit")}
            </SecondaryButton>
            <SecondaryButton
              disabled={checkRunning}
              onClick={() => void runCheck("/api/admin/check-storage")}
            >
              {t("admin.checkStorage")}
            </SecondaryButton>
            <SecondaryButton
              disabled={checkRunning}
              onClick={() => void runCheck("/api/admin/check-openai")}
            >
              {t("admin.checkOpenAi")}
            </SecondaryButton>
            <SecondaryButton
              disabled={checkRunning}
              onClick={() => void runCheck("/api/admin/check-ffmpeg")}
            >
              {t("admin.checkFfmpeg")}
            </SecondaryButton>
            <SecondaryButton
              disabled={checkRunning}
              onClick={() => void runCheck("/api/admin/check-voximplant")}
            >
              {t("admin.checkVoximplant")}
            </SecondaryButton>
          </div>
          {checkMessage ? (
            <p className="text-sm text-slate-400">{checkMessage}</p>
          ) : null}
        </CardContent>
      </Card>
      ) : null}

      {showLog ? (
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("admin.recentServiceEvents")}
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {!data || data.recentEvents.length === 0 ? (
            <div className="px-6 py-8 text-sm text-slate-400">—</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50 text-left text-slate-400">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Service</th>
                    <th className="px-4 py-3 font-medium">Severity</th>
                    <th className="px-4 py-3 font-medium">Code</th>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Session</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentEvents.map((event) => (
                    <tr key={event.id} className="border-b border-slate-800/60">
                      <td className="px-4 py-3 text-slate-300">{formatDate(event.createdAt)}</td>
                      <td className="px-4 py-3 text-slate-300">{event.service}</td>
                      <td className="px-4 py-3 text-slate-300">{event.severity}</td>
                      <td className="px-4 py-3 text-slate-400">{event.errorCode ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="max-w-xs text-slate-200">{event.title}</div>
                        <div className="mt-1 max-w-md text-xs text-slate-500">{event.message}</div>
                      </td>
                      <td className="px-4 py-3">
                        {event.sessionId ? (
                          <Link
                            href={`/sessions/${event.sessionId}`}
                            className="text-cyan-400 hover:text-cyan-300"
                          >
                            {event.sessionId.slice(0, 8)}…
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {event.resolvedAt ? t("admin.resolved") : t("admin.unresolved")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      ) : null}

      {showCounters ? (
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("admin.usageCounters")}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{t("admin.usageDisclaimer")}</p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {data ? (
            <>
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                <p className="text-xs text-slate-500">LiveKit audio recording minutes</p>
                <p className="text-lg font-semibold text-slate-100">
                  {data.usage.livekitRecordingMinutes.toFixed(1)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                <p className="text-xs text-slate-500">Voximplant conference minutes</p>
                <p className="text-lg font-semibold text-slate-100">
                  {data.usage.voximplantConferenceMinutes > 0
                    ? data.usage.voximplantConferenceMinutes.toFixed(1)
                    : "not available"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                <p className="text-xs text-slate-500">OpenAI transcription minutes</p>
                <p className="text-lg font-semibold text-slate-100">
                  {data.usage.openAiTranscriptionMinutes.toFixed(1)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                <p className="text-xs text-slate-500">Yandex SpeechKit minutes</p>
                <p className="text-lg font-semibold text-slate-100">
                  {data.usage.yandexSpeechKitMinutes > 0
                    ? data.usage.yandexSpeechKitMinutes.toFixed(1)
                    : "not available"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                <p className="text-xs text-slate-500">Yandex AI analysis runs</p>
                <p className="text-lg font-semibold text-slate-100">
                  {data.usage.yandexAiAnalysisRuns > 0
                    ? data.usage.yandexAiAnalysisRuns
                    : "not available"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                <p className="text-xs text-slate-500">OpenAI transcription bytes</p>
                <p className="text-lg font-semibold text-slate-100">
                  {formatBytes(data.usage.openAiTranscriptionBytes)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                <p className="text-xs text-slate-500">Yandex uploaded bytes</p>
                <p className="text-lg font-semibold text-slate-100">
                  {formatBytes(data.usage.storageUploadedBytes)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                <p className="text-xs text-slate-500">Yandex downloaded bytes</p>
                <p className="text-lg font-semibold text-slate-100">
                  {formatBytes(data.usage.storageDownloadedBytes)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                <p className="text-xs text-slate-500">Recordings created</p>
                <p className="text-lg font-semibold text-slate-100">
                  {data.usage.recordingsCreated}
                </p>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
      ) : null}
    </div>
  );
}
