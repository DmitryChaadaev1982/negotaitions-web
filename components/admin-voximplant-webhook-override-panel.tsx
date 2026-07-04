"use client";

import { useState, useTransition } from "react";

import {
  clearVoximplantRecordingWebhookOverrideAction,
  saveVoximplantRecordingWebhookOverrideAction,
} from "@/app/actions/voximplant-recording-webhook";
import { GradientButton, SecondaryButton } from "@/components/ui/buttons";
import { useI18n } from "@/lib/i18n/useI18n";
import type { VoximplantRecordingWebhookUrlState } from "@/lib/voximplant/recording-webhook-url";

type AdminVoximplantWebhookOverridePanelProps = {
  initialState: VoximplantRecordingWebhookUrlState;
  onStateChange?: (state: VoximplantRecordingWebhookUrlState) => void;
};

function ValueRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-slate-400">{label}</span>
      <code className="break-all text-sm text-slate-100">{value ?? "—"}</code>
    </div>
  );
}

export function AdminVoximplantWebhookOverridePanel({
  initialState,
  onStateChange,
}: AdminVoximplantWebhookOverridePanelProps) {
  const { t } = useI18n();
  const [state, setState] = useState(initialState);
  const [inputUrl, setInputUrl] = useState(initialState.override ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function applyState(next: VoximplantRecordingWebhookUrlState) {
    setState(next);
    onStateChange?.(next);
  }

  function handleSave() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await saveVoximplantRecordingWebhookOverrideAction(inputUrl);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      applyState(result.state);
      setInputUrl(result.state.override ?? "");
      setSuccess(t("admin.voximplantWebhookOverrideSaved"));
    });
  }

  function handleReset() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await clearVoximplantRecordingWebhookOverrideAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      applyState(result.state);
      setInputUrl("");
      setSuccess(t("admin.voximplantWebhookOverrideCleared"));
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <ValueRow label={t("admin.voximplantWebhookNodeEnv")} value={state.nodeEnv} />
        <ValueRow
          label={t("admin.voximplantWebhookOverrideEnabledRaw")}
          value={state.overrideEnabledRaw ?? t("admin.unset")}
        />
        <ValueRow
          label={t("admin.voximplantWebhookOverrideEnabledEffective")}
          value={state.overrideEnabled ? "true" : "false"}
        />
        <ValueRow
          label={t("admin.voximplantWebhookEnvDefault")}
          value={state.envDefault}
        />
        <ValueRow
          label={
            state.savedOverridePresent && !state.savedOverrideActive
              ? t("admin.voximplantWebhookSavedOverrideInactive")
              : t("admin.voximplantWebhookSavedOverride")
          }
          value={state.override}
        />
        <ValueRow label={t("admin.voximplantWebhookEffectiveUrl")} value={state.effective} />
        {state.warning ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-900/15 px-4 py-3 text-sm text-amber-100">
            {state.warning}
          </div>
        ) : null}
      </div>

      {!state.overrideEnabled ? (
        <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
          {state.overrideEnabledRaw === "false"
            ? t("admin.voximplantWebhookOverrideDisabledExplicit")
            : !state.overrideEnabledRaw && state.nodeEnv === "production"
              ? t("admin.voximplantWebhookOverrideDisabledDefault")
              : t("admin.voximplantWebhookOverrideDisabledGeneric")}
        </div>
      ) : (
        <>
          <div
            className="rounded-lg border border-amber-500/30 bg-amber-900/15 px-4 py-3 text-sm text-amber-100"
            role="note"
          >
            {t("admin.voximplantWebhookOverrideHint")}
          </div>

          <label className="block space-y-2">
            <span className="text-sm text-slate-300">{t("admin.voximplantWebhookInputLabel")}</span>
            <input
              type="url"
              value={inputUrl}
              onChange={(event) => setInputUrl(event.target.value)}
              placeholder="https://abc.trycloudflare.com"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/40 focus:outline-none"
              data-testid="voximplant-webhook-url-input"
            />
          </label>

          {error ? (
            <p className="text-sm text-rose-400" role="alert" data-testid="voximplant-webhook-url-error">
              {error}
            </p>
          ) : null}
          {success ? (
            <p
              className="text-sm text-emerald-400"
              role="status"
              data-testid="voximplant-webhook-url-success"
            >
              {success}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <GradientButton
              type="button"
              onClick={handleSave}
              disabled={isPending || !inputUrl.trim()}
              data-testid="voximplant-webhook-url-save"
            >
              {t("admin.voximplantWebhookSaveOverride")}
            </GradientButton>
            <SecondaryButton
              type="button"
              onClick={handleReset}
              disabled={isPending || !state.override}
              data-testid="voximplant-webhook-url-reset"
            >
              {t("admin.voximplantWebhookResetOverride")}
            </SecondaryButton>
          </div>
        </>
      )}
    </div>
  );
}
