"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { SecondaryButton } from "@/components/ui/buttons";
import { useI18n } from "@/lib/i18n/useI18n";

type HealthData = {
  config: Record<string, boolean> & {
    ffmpeg?: {
      available: boolean;
      path: string | null;
      source: "env" | "system" | "static" | null;
    };
  };
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
    openAiTranscriptionMinutes: number;
    openAiTranscriptionBytes: number;
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

function ConfigRow({ label, configured }: { label: string; configured: boolean }) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
      <span className="text-sm text-slate-300">{label}</span>
      <span
        className={
          configured
            ? "text-sm font-medium text-emerald-400"
            : "text-sm font-medium text-amber-400"
        }
      >
        {configured ? t("admin.configured") : t("admin.missing")}
      </span>
    </div>
  );
}

function FfmpegConfigRow({
  available,
  path,
  source,
}: {
  available: boolean;
  path: string | null;
  source: "env" | "system" | "static" | null;
}) {
  const { t } = useI18n();

  const sourceLabel =
    source === "env"
      ? t("admin.ffmpegSourceEnv")
      : source === "system"
        ? t("admin.ffmpegSourceSystem")
        : source === "static"
          ? t("admin.ffmpegSourceStatic")
          : null;

  return (
    <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-slate-300">ffmpeg</span>
        <span
          className={
            available
              ? "text-sm font-medium text-emerald-400"
              : "text-sm font-medium text-amber-400"
          }
        >
          {available ? t("admin.configured") : t("admin.missing")}
        </span>
      </div>
      {available && path ? (
        <div className="mt-2 space-y-1 text-xs text-slate-500">
          {sourceLabel ? <p>{sourceLabel}</p> : null}
          <p className="break-all font-mono text-slate-400">{path}</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">{t("admin.ffmpegUnavailableHint")}</p>
      )}
    </div>
  );
}

export function AdminDiagnosticsView() {
  const { t, locale } = useI18n();
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

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("admin.title")}
        description={t("admin.externalServices")}
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200"
            >
              {t("nav.admin")}
            </Link>
            <Link
              href="/admin/users"
              className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
            >
              {t("admin.userManagement")}
            </Link>
          </div>
        }
      />

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

      <Card>
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
              <ConfigRow label="LIVEKIT_URL" configured={data.config.livekitUrl} />
              <ConfigRow label="LIVEKIT_API_KEY" configured={data.config.livekitApiKey} />
              <ConfigRow label="LIVEKIT_API_SECRET" configured={data.config.livekitApiSecret} />
              <ConfigRow label="S3_BUCKET" configured={data.config.s3Bucket} />
              <ConfigRow label="S3_REGION" configured={data.config.s3Region} />
              <ConfigRow label="S3_ENDPOINT" configured={data.config.s3Endpoint} />
              <ConfigRow label="S3_ACCESS_KEY_ID" configured={data.config.s3AccessKeyId} />
              <ConfigRow label="S3_SECRET_ACCESS_KEY" configured={data.config.s3SecretAccessKey} />
              <ConfigRow label="OPENAI_API_KEY" configured={data.config.openAiApiKey} />
              <FfmpegConfigRow
                available={data.config.ffmpeg?.available ?? false}
                path={data.config.ffmpeg?.path ?? null}
                source={data.config.ffmpeg?.source ?? null}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
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
          </div>
          {checkMessage ? (
            <p className="text-sm text-slate-400">{checkMessage}</p>
          ) : null}
        </CardContent>
      </Card>

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
                <p className="text-xs text-slate-500">OpenAI transcription minutes</p>
                <p className="text-lg font-semibold text-slate-100">
                  {data.usage.openAiTranscriptionMinutes.toFixed(1)}
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
    </div>
  );
}
