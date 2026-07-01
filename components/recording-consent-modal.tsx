"use client";

import { useI18n } from "@/lib/i18n/useI18n";
import { useState } from "react";

/** Modal that gates recording start behind explicit user consent. */
export function RecordingConsentModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="recording-consent-modal"
    >
      <div
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900 p-6 shadow-2xl space-y-4">
        <h2 className="text-base font-semibold text-slate-50">
          {t("legal.recordingConsentTitle")}
        </h2>
        <div className="rounded-lg border border-amber-500/30 bg-amber-900/20 px-4 py-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              data-testid="recording-consent-checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-cyan-500"
            />
            <span className="text-sm text-amber-100 leading-relaxed">
              {t("legal.recordingConsentText")}
            </span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!checked}
            onClick={onConfirm}
            data-testid="recording-consent-confirm"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t("legal.recordingConsentConfirm")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            data-testid="recording-consent-cancel"
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
          >
            {t("legal.recordingConsentCancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
