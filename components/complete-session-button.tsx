"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { DangerButton, SecondaryButton } from "@/components/ui/buttons";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/useI18n";

type CompleteSessionResponse = {
  completed: boolean;
  alreadyCompleted: boolean;
  operationId: string;
  negotiationState: string;
  roomLifecycle: string | null;
  closeReason: string | null;
  closedByEventAt: string | null;
  recording: {
    status: string | null;
    stopOperationId: string | null;
    stopOperationState: string | null;
    warning: string | null;
  };
  warnings: string[];
  refreshHint: "refresh";
  redirectTo: string;
};

type CompleteSessionButtonProps = {
  sessionId: string;
  variant?: "link" | "button";
  className?: string;
  disabled?: boolean;
  requestPayload?: Record<string, unknown>;
  confirmBody?: string;
  testId?: string;
  onCompleted?: (result: CompleteSessionResponse) => void;
};

export function CompleteSessionButton({
  sessionId,
  variant = "link",
  className,
  disabled = false,
  requestPayload,
  confirmBody,
  testId = "complete-session-button",
  onCompleted,
}: CompleteSessionButtonProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const focusTrigger = () => {
    window.setTimeout(() => {
      triggerRef.current?.focus();
    }, 0);
  };

  const closeDialog = () => {
    if (submitting) {
      return;
    }
    setOpen(false);
    focusTrigger();
  };

  const handleComplete = async () => {
    if (submitting || disabled) {
      return;
    }
    setSubmitting(true);
    setError(null);
    setFeedback(null);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload ?? {}),
      });
      const payload = (await response.json().catch(() => ({}))) as
        | CompleteSessionResponse
        | { error?: string };
      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error : "Unable to complete session.");
      }

      const result = payload as CompleteSessionResponse;
      onCompleted?.(result);
      setOpen(false);
      setFeedback(
        result.alreadyCompleted
          ? t("sessions.alreadyCompleted")
          : t("sessions.sessionCompleted"),
      );
      if (result.recording.warning) {
        setError(result.recording.warning);
      }
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("sessions.completeSessionFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled || submitting}
          className={cn(
            variant === "button"
              ? "complete-session-trigger complete-session-trigger-danger inline-flex items-center justify-center rounded-lg border border-rose-500/40 bg-transparent px-5 py-2.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/10 disabled:opacity-50"
              : "complete-session-trigger complete-session-trigger-danger text-sm font-medium text-rose-300 hover:text-rose-200 disabled:opacity-50",
            className,
          )}
          aria-label={t("sessions.completeSession")}
          data-testid={testId}
        >
          {submitting ? t("common.loading") : t("sessions.completeSession")}
        </button>
        {feedback ? (
          <p className="text-xs text-emerald-300" aria-live="polite">
            {feedback}
          </p>
        ) : null}
        {error ? (
          <p className="max-w-64 text-right text-xs text-amber-300" aria-live="polite">
            {error}
          </p>
        ) : null}
      </div>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-[#020617]/80 backdrop-blur-sm"
            aria-label={t("common.cancel")}
            onClick={closeDialog}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="relative w-full max-w-md rounded-xl border border-slate-700/60 bg-slate-900/95 p-6 shadow-2xl shadow-black/50 ring-1 ring-slate-600/30"
          >
            <h2 id={titleId} className="text-lg font-semibold text-slate-50">
              {t("sessions.completeSessionConfirmTitle")}
            </h2>
            <p id={descriptionId} className="mt-3 text-sm leading-6 text-slate-400">
              {confirmBody ?? t("sessions.completeSessionConfirmBody")}
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <SecondaryButton type="button" onClick={closeDialog} disabled={submitting}>
                {t("common.cancel")}
              </SecondaryButton>
              <DangerButton
                type="button"
                disabled={submitting}
                onClick={() => void handleComplete()}
                aria-label={t("sessions.completeSessionConfirm")}
                data-testid="confirm-complete-session-button"
              >
                {submitting ? t("common.loading") : t("sessions.completeSessionConfirm")}
              </DangerButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
