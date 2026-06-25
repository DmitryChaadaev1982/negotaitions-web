"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n/useI18n";

type DetectedSpeaker = {
  speakerLabel: string;
  displaySpeakerLabel: string;
  mappedParticipantId: string | null;
};

type ParticipantOption = {
  sessionParticipantId: string;
  displayName: string;
  participantType: string;
  roleName: string | null;
};

type SpeakerMappingData = {
  transcriptId: string;
  speakerMappingStatus: string;
  speakerMappingConfirmedAt: string | null;
  hasSpeakerDiarization: boolean;
  detectedSpeakers: DetectedSpeaker[];
  participants: ParticipantOption[];
  canEdit: boolean;
};

type AutoSuggestion = {
  available: boolean;
  unavailableReason: string | null;
  mapping: Record<string, string | null>;
  confidence: Record<string, number>;
};

type SpeakerMappingPanelProps = {
  sessionId: string;
  joinToken: string;
};

function confidenceLabel(
  confidence: number | undefined,
  t: (k: string) => string,
): string {
  if (confidence === undefined) return "";
  if (confidence >= 0.6) return t("recording.strongSuggestion");
  if (confidence >= 0.35) return t("recording.weakSuggestion");
  return t("recording.noReliableSuggestion");
}

function confidenceTone(confidence: number | undefined): string {
  if (confidence === undefined) return "text-slate-400";
  if (confidence >= 0.6) return "text-emerald-400";
  if (confidence >= 0.35) return "text-amber-400";
  return "text-rose-400";
}

export function SpeakerMappingPanel({ sessionId, joinToken }: SpeakerMappingPanelProps) {
  const { t } = useI18n();
  const [data, setData] = useState<SpeakerMappingData | null>(null);
  const [localMapping, setLocalMapping] = useState<Record<string, string | null>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<AutoSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMapping = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/speaker-mapping?joinToken=${encodeURIComponent(joinToken)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as SpeakerMappingData;
      setData(json);

      const initial: Record<string, string | null> = {};
      for (const speaker of json.detectedSpeakers) {
        initial[speaker.speakerLabel] = speaker.mappedParticipantId;
      }
      setLocalMapping(initial);
    } catch {
      // ignore transient errors
    }
  }, [sessionId, joinToken]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchMapping();
    });
  }, [fetchMapping]);

  const handleSave = useCallback(
    async (confirm = false) => {
      if (confirm) {
        setIsConfirming(true);
      } else {
        setIsSaving(true);
      }
      setError(null);

      try {
        const res = await fetch(`/api/sessions/${sessionId}/speaker-mapping`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            joinToken,
            mapping: localMapping,
            confirm,
            applyToTranscript: true,
          }),
        });

        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? "Failed to save mapping.");
        }

        await fetchMapping();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save mapping.");
      } finally {
        setIsSaving(false);
        setIsConfirming(false);
      }
    },
    [sessionId, joinToken, localMapping, fetchMapping],
  );

  const handleSuggestAutomatically = useCallback(async () => {
    setIsSuggesting(true);
    setSuggestion(null);
    setError(null);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/speaker-mapping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          joinToken,
          suggestAutomatically: true,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Auto-suggest failed.");
      }

      const body = (await res.json()) as AutoSuggestion;
      setSuggestion(body);

      if (body.available) {
        // Apply suggestions to local state
        setLocalMapping((prev) => ({
          ...prev,
          ...body.mapping,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-suggest failed.");
    } finally {
      setIsSuggesting(false);
    }
  }, [sessionId, joinToken]);

  if (!data) return null;
  if (!data.hasSpeakerDiarization) return null;
  if (data.detectedSpeakers.length === 0) return null;

  const isConfirmed = data.speakerMappingStatus === "CONFIRMED";

  return (
    <div
      className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3 space-y-3"
      data-testid="speaker-mapping-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {t("room.speakerMapping")}
        </p>
        {isConfirmed && (
          <span
            className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-2 py-0.5 text-xs font-medium text-emerald-400"
            data-testid="speaker-mapping-confirmed-badge"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {t("room.speakerMappingConfirmed")}
          </span>
        )}
      </div>

      {/* Speaker rows */}
      {data.detectedSpeakers.map((speaker) => {
        const speakerConf =
          suggestion?.confidence?.[speaker.speakerLabel];
        return (
          <div key={speaker.speakerLabel} className="space-y-1">
            <label
              className="block text-xs font-medium text-slate-300"
              htmlFor={`speaker-select-${speaker.speakerLabel}`}
            >
              {speaker.displaySpeakerLabel}
              {speakerConf !== undefined && (
                <span className={`ml-2 text-xs ${confidenceTone(speakerConf)}`}>
                  {confidenceLabel(speakerConf, t as (k: string) => string)}
                  {` (${Math.round(speakerConf * 100)}%)`}
                </span>
              )}
            </label>

            {data.canEdit && !isConfirmed ? (
              <select
                id={`speaker-select-${speaker.speakerLabel}`}
                className="w-full rounded-md border border-slate-600/50 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 focus:border-cyan-500/50 focus:outline-none"
                value={localMapping[speaker.speakerLabel] ?? ""}
                onChange={(e) =>
                  setLocalMapping((prev) => ({
                    ...prev,
                    [speaker.speakerLabel]: e.target.value || null,
                  }))
                }
                data-testid={`speaker-select-${speaker.speakerLabel}`}
              >
                <option value="">{t("recording.unassigned")}</option>
                {data.participants.map((p) => (
                  <option key={p.sessionParticipantId} value={p.sessionParticipantId}>
                    {p.displayName}
                    {p.roleName ? ` — ${p.roleName}` : ""}
                    {` (${p.participantType.toLowerCase()})`}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-slate-400">
                {localMapping[speaker.speakerLabel]
                  ? (data.participants.find(
                      (p) => p.sessionParticipantId === localMapping[speaker.speakerLabel],
                    )?.displayName ?? t("recording.unassigned"))
                  : t("recording.unassigned")}
              </div>
            )}
          </div>
        );
      })}

      {/* Auto-suggestion unavailable message */}
      {suggestion && !suggestion.available && (
        <p className="text-xs text-amber-400">
          {suggestion.unavailableReason === "no_timestamps"
            ? t("room.autoMappingUnavailable")
            : t("room.autoMappingFutureOnly")}
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-rose-400">{error}</p>
      )}

      {/* Actions */}
      {data.canEdit && !isConfirmed && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="rounded-md border border-slate-600/50 bg-slate-700/50 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            onClick={() => void handleSuggestAutomatically()}
            disabled={isSuggesting}
            data-testid="suggest-automatically-button"
          >
            {isSuggesting ? t("common.loading") : t("room.suggestAutomatically")}
          </button>

          <button
            type="button"
            className="rounded-md border border-slate-600/50 bg-slate-700/50 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            onClick={() => void handleSave(false)}
            disabled={isSaving || isConfirming}
            data-testid="save-mapping-button"
          >
            {isSaving ? t("common.loading") : t("room.saveMappingButton")}
          </button>

          <button
            type="button"
            className="rounded-md border border-emerald-500/40 bg-emerald-900/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
            onClick={() => void handleSave(true)}
            disabled={isSaving || isConfirming}
            data-testid="confirm-mapping-button"
          >
            {isConfirming ? t("common.loading") : t("room.confirmMappingButton")}
          </button>
        </div>
      )}
    </div>
  );
}
