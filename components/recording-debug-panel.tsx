"use client";

/**
 * Stage 5.4.8 — Temporary Voximplant recording diagnostics panel.
 *
 * Visible only for the facilitator when:
 *   - VIDEO_PROVIDER = voximplant  (checked via NEXT_PUBLIC_VIDEO_PROVIDER or
 *     deduced from API response env.videoProvider)
 *   - NEXT_PUBLIC_RECORDING_DEBUG_PANEL=true  OR  ?debugRecording=1 query param
 *
 * This panel is entirely dev/diagnostic and must NOT be shown in production
 * unless explicitly opted in. All render logic is guarded.
 *
 * Panel sections:
 *   1. Runtime env snapshot
 *   2. Pipeline checklist (derived from events + DB state)
 *   3. DB snapshot
 *   4. Event log table
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types (mirror server response) ──────────────────────────────────────────

type DebugEventLevel = "info" | "warn" | "error" | "success";

type RecordingDebugEvent = {
  id: string;
  ts: string;
  sessionId: string;
  source: string;
  level: DebugEventLevel;
  step: string;
  message: string;
  data?: Record<string, unknown>;
};

type DiagnosticSnapshot = {
  ok: boolean;
  enabled: boolean;
  sessionId: string;
  env: {
    nodeEnv: string | null;
    videoProvider: string;
    voximplantScenarioName: string | null;
    voximplantRuleName: string | null;
    webhookBaseUrl: string | null;
    diagnosticsEnabled: boolean;
    webhookSecretConfigured: boolean;
    /** Stage 5.4.9: last buildId written by vox:scenario:prepare */
    voximplantLastSyncedBuildId?: string | null;
  };
  db: {
    session: { id: string; status: string; updatedAt: string } | null;
    recording: {
      id: string;
      status: string;
      fileKey: null;
      fileKeyPresent: boolean;
      errorMessage: string | null;
      createdAt: string;
      updatedAt: string;
    } | null;
  };
  expectedPipeline: readonly string[];
  events: RecordingDebugEvent[];
};

// ─── Pipeline step derivation ─────────────────────────────────────────────────

const PIPELINE_STEPS: { label: string; check: (snap: DiagnosticSnapshot) => boolean | null }[] = [
  {
    label: "Session exists in DB",
    check: (s) => Boolean(s.db.session),
  },
  {
    label: "Recording row created",
    check: (s) => Boolean(s.db.recording),
  },
  {
    label: "Start API called",
    check: (s) =>
      s.events.some(
        (e) =>
          e.source === "recording-control" &&
          e.step.includes(":start:") &&
          e.level !== "error",
      ),
  },
  {
    label: "Start scenarioMessage returned",
    check: (s) =>
      s.events.some(
        (e) => e.source === "scenario-message" && e.step.includes(":start:"),
      ),
  },
  {
    label: "Start message sent to VoxEngine",
    check: (s) =>
      s.events.some(
        (e) =>
          e.source === "client" &&
          e.step.includes("sendConferenceMessage:start") &&
          e.level === "success",
      ),
  },
  {
    label: "Recording status STARTING/RECORDING",
    check: (s) => {
      const st = s.db.recording?.status;
      return st === "STARTING" || st === "RECORDING" || null;
    },
  },
  {
    label: "Stop API called",
    check: (s) =>
      s.events.some(
        (e) =>
          e.source === "recording-control" &&
          e.step.includes(":stop:") &&
          e.level !== "error",
      ),
  },
  {
    label: "Stop scenarioMessage returned",
    check: (s) =>
      s.events.some(
        (e) => e.source === "scenario-message" && e.step.includes(":stop:"),
      ),
  },
  {
    label: "Stop message sent to VoxEngine",
    check: (s) =>
      s.events.some(
        (e) =>
          e.source === "client" &&
          e.step.includes("sendConferenceMessage:stop") &&
          e.level === "success",
      ),
  },
  {
    label: "Recording status STOPPED",
    check: (s) => {
      const st = s.db.recording?.status;
      return st === "STOPPED" || st === "COMPLETED" || null;
    },
  },
  {
    label: "Webhook hit",
    check: (s) =>
      s.events.some((e) => e.source === "webhook" && e.step === "webhook:hit"),
  },
  {
    label: "Webhook signature valid",
    check: (s) =>
      s.events.some(
        (e) => e.source === "webhook" && e.step === "webhook:signature:valid",
      ),
  },
  {
    label: "fileKey received",
    check: (s) => {
      const r = s.db.recording;
      if (!r) return null;
      return r.fileKeyPresent;
    },
  },
  {
    label: "Recording COMPLETED",
    check: (s) => s.db.recording?.status === "COMPLETED",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function levelClass(level: DebugEventLevel): string {
  switch (level) {
    case "success":
      return "text-green-400";
    case "error":
      return "text-red-400";
    case "warn":
      return "text-amber-400";
    default:
      return "text-slate-300";
  }
}

function levelBadge(level: DebugEventLevel): string {
  switch (level) {
    case "success":
      return "bg-green-900/40 text-green-300";
    case "error":
      return "bg-red-900/40 text-red-300";
    case "warn":
      return "bg-amber-900/40 text-amber-300";
    default:
      return "bg-slate-700/50 text-slate-300";
  }
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  } catch {
    return ts;
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

type RecordingDebugPanelProps = {
  sessionId: string;
  participantId?: string;
  /** If true, panel is rendered. External guard — caller should already check isFacilitator. */
  visible: boolean;
};

export function RecordingDebugPanel({
  sessionId,
  participantId,
  visible,
}: RecordingDebugPanelProps) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyDone, setCopyDone] = useState(false);
  const [copyLogMarkerDone, setCopyLogMarkerDone] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`/api/debug/recording/${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        setError("Diagnostics endpoint not available. Enable RECORDING_DEBUG_PANEL=true.");
        return;
      }
      if (!res.ok) {
        setError(`API error: ${res.status}`);
        return;
      }
      const data = (await res.json()) as DiagnosticSnapshot;
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed");
    }
  }, [sessionId]);

  // Poll while open.
  useEffect(() => {
    if (!visible || !open) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSnapshot();

    pollingRef.current = setInterval(() => {
      void fetchSnapshot();
    }, 1500);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [visible, open, fetchSnapshot]);

  const handleClear = async () => {
    try {
      await fetch(`/api/debug/recording/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      await fetchSnapshot();
    } catch {
      // ignore
    }
  };

  const handleCopyJson = () => {
    if (!snapshot) return;
    void navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2)).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  };

  const handleCopyLogMarker = () => {
    if (!snapshot) return;
    const buildId = snapshot.env.voximplantLastSyncedBuildId ?? "<buildId>";
    const sourceName = snapshot.env.voximplantScenarioName ?? "neg-conf-main-room";
    const marker = `[neg-conf-prod] scenario build=${buildId} source=${sourceName}`;
    void navigator.clipboard.writeText(marker).then(() => {
      setCopyLogMarkerDone(true);
      setTimeout(() => setCopyLogMarkerDone(false), 2000);
    });
  };

  if (!visible) return null;

  return (
    <div className="shrink-0 border-t border-slate-700 bg-slate-900/95 text-xs font-mono">
      {/* Header / toggle */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2 text-slate-400 hover:text-slate-200"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-semibold text-violet-300">
          Диагностика записи (Voximplant)
        </span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="max-h-[60vh] overflow-y-auto px-4 pb-4 space-y-3">
          {error && (
            <p className="text-red-400">{error}</p>
          )}

          {snapshot && (
            <>
              {/* ── Action buttons ─────────────────────────────────────── */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void fetchSnapshot()}
                  className="rounded bg-slate-700/60 px-2 py-0.5 text-slate-300 hover:bg-slate-600/60"
                >
                  Обновить
                </button>
                <button
                  type="button"
                  onClick={() => void handleClear()}
                  className="rounded bg-slate-700/60 px-2 py-0.5 text-slate-300 hover:bg-red-900/50"
                >
                  Очистить события
                </button>
                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="rounded bg-slate-700/60 px-2 py-0.5 text-slate-300 hover:bg-slate-600/60"
                >
                  {copyDone ? "Скопировано ✓" : "Копировать JSON"}
                </button>
              </div>

              {/* ── Section 1: Runtime ────────────────────────────────── */}
              <Section title="1. Runtime">
                <Row label="videoProvider" value={snapshot.env.videoProvider} />
                <Row label="scenarioName" value={snapshot.env.voximplantScenarioName ?? "—"} />
                <Row label="ruleName" value={snapshot.env.voximplantRuleName ?? "—"} />
                <Row label="webhookBaseUrl" value={snapshot.env.webhookBaseUrl ?? "—"} />
                <Row label="webhookSecretConfigured" value={snapshot.env.webhookSecretConfigured} />
                <Row label="sessionId" value={snapshot.sessionId} />
                {participantId && <Row label="participantId" value={participantId} />}
                <Row label="nodeEnv" value={snapshot.env.nodeEnv ?? "—"} />
              </Section>

              {/* ── Section 1b: Scenario Sync (Stage 5.4.9) ──────────── */}
              <Section title="1b. Scenario Sync">
                <Row
                  label="expectedScenarioName"
                  value={snapshot.env.voximplantScenarioName ?? "—"}
                />
                <Row
                  label="expectedRuleName"
                  value={snapshot.env.voximplantRuleName ?? "—"}
                />
                <Row
                  label="lastSyncedBuildId"
                  value={snapshot.env.voximplantLastSyncedBuildId ?? "not prepared yet"}
                />
                <div className="mt-1.5 rounded border border-amber-700/40 bg-amber-950/30 px-2 py-1.5 text-amber-300/90">
                  <p className="font-semibold mb-0.5">Runtime confirmation required</p>
                  <p className="text-amber-400/70 leading-snug">
                    After uploading, create a new session and look for this line in Voximplant logs:
                  </p>
                  <p className="mt-1 font-mono text-amber-200 break-all">
                    [neg-conf-prod] scenario build=
                    {snapshot.env.voximplantLastSyncedBuildId ?? "<buildId>"}
                  </p>
                  <p className="mt-1 text-amber-400/70 text-[10px]">
                    If logs show &quot;Loading scenario neg-conf&quot; or &quot;[neg-conf-rec]&quot;,
                    the rule still points to an old scenario — re-upload and verify rule binding.
                  </p>
                </div>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={handleCopyLogMarker}
                    className="rounded bg-slate-700/60 px-2 py-0.5 text-slate-300 hover:bg-slate-600/60"
                  >
                    {copyLogMarkerDone ? "Скопировано ✓" : "Copy expected log marker"}
                  </button>
                </div>
              </Section>

              {/* ── Section 2: Pipeline checklist ─────────────────────── */}
              <Section title="2. Pipeline">
                <div className="space-y-0.5">
                  {PIPELINE_STEPS.map((step) => {
                    const result = step.check(snapshot);
                    const icon =
                      result === true
                        ? "✓"
                        : result === false
                          ? "✗"
                          : "·";
                    const cls =
                      result === true
                        ? "text-green-400"
                        : result === false
                          ? "text-red-400"
                          : "text-slate-500";
                    return (
                      <div key={step.label} className="flex items-center gap-2">
                        <span className={`w-3 text-center font-bold ${cls}`}>{icon}</span>
                        <span className={cls}>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* ── Section 3: DB snapshot ────────────────────────────── */}
              <Section title="3. DB Snapshot">
                {snapshot.db.recording ? (
                  <>
                    <Row label="recording.id" value={snapshot.db.recording.id} />
                    <Row label="recording.status" value={snapshot.db.recording.status} />
                    <Row label="fileKeyPresent" value={snapshot.db.recording.fileKeyPresent} />
                    <Row
                      label="errorMessage"
                      value={snapshot.db.recording.errorMessage ?? "—"}
                    />
                    <Row label="updatedAt" value={formatTime(snapshot.db.recording.updatedAt)} />
                  </>
                ) : (
                  <p className="text-slate-500">Recording row not found in DB.</p>
                )}
                {snapshot.db.session && (
                  <Row label="session.status" value={snapshot.db.session.status} />
                )}
              </Section>

              {/* ── Section 4: Event log ──────────────────────────────── */}
              <Section title={`4. Events (${snapshot.events.length})`}>
                {snapshot.events.length === 0 ? (
                  <p className="text-slate-500">No events yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[10px]">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-700">
                          <th className="text-left pr-2 pb-1 whitespace-nowrap">Time</th>
                          <th className="text-left pr-2 pb-1">Source</th>
                          <th className="text-left pr-2 pb-1">Level</th>
                          <th className="text-left pr-2 pb-1">Step</th>
                          <th className="text-left pb-1">Message</th>
                          <th className="text-left pb-1">Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...snapshot.events].reverse().map((ev) => (
                          <tr key={ev.id} className="border-b border-slate-800/50">
                            <td className="pr-2 py-0.5 whitespace-nowrap text-slate-500">
                              {formatTime(ev.ts)}
                            </td>
                            <td className="pr-2 py-0.5 text-slate-400">{ev.source}</td>
                            <td className="pr-2 py-0.5">
                              <span
                                className={`rounded px-1 ${levelBadge(ev.level)}`}
                              >
                                {ev.level}
                              </span>
                            </td>
                            <td className={`pr-2 py-0.5 ${levelClass(ev.level)}`}>
                              {ev.step}
                            </td>
                            <td className={`py-0.5 pr-2 ${levelClass(ev.level)}`}>
                              {ev.message}
                            </td>
                            <td className="py-0.5 text-slate-500 max-w-[200px] truncate">
                              {ev.data ? JSON.stringify(ev.data) : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </>
          )}

          {!snapshot && !error && (
            <p className="text-slate-500">Загрузка...</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-slate-500 font-semibold mb-1 border-b border-slate-800 pb-0.5">
        {title}
      </p>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string | boolean | number | null | undefined;
}) {
  const display =
    typeof value === "boolean"
      ? value
        ? "true"
        : "false"
      : value == null
        ? "—"
        : String(value);

  const cls =
    value === true
      ? "text-green-400"
      : value === false
        ? "text-red-400"
        : "text-slate-200";

  return (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className={`${cls} text-right break-all max-w-[60%]`}>{display}</span>
    </div>
  );
}
