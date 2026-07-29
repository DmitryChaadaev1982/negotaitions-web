"use client";

import { SecondaryButton } from "@/components/ui/buttons";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import { useI18n } from "@/lib/i18n/useI18n";

type EventCompletionDangerZoneProps = {
  showCompleteDialog: boolean;
  isCompletingEvent: boolean;
  onShowCompleteDialog: (open: boolean) => void;
  onCompleteEvent: () => void;
};

export function EventCompletionDangerZone({
  showCompleteDialog,
  isCompletingEvent,
  onShowCompleteDialog,
  onCompleteEvent,
}: EventCompletionDangerZoneProps) {
  const { t } = useI18n();

  return (
    <GlassCard elevated className="border-rose-500/35" data-testid="event-completion-danger-zone">
      <GlassCardHeader>
        <h3 className="text-sm font-semibold text-rose-200">{t("events.eventCompletion")}</h3>
      </GlassCardHeader>
      <GlassCardContent className="space-y-4">
        <p className="text-xs leading-5 text-rose-200/90">
          {t("events.eventCompletionDangerHint")}
        </p>
        <button
          type="button"
          data-testid="complete-event-button"
          className="w-full rounded-lg border border-rose-500/40 bg-transparent px-3 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/10"
          onClick={() => onShowCompleteDialog(true)}
        >
          {t("events.completeEntireEvent")}
        </button>
      </GlassCardContent>

      {showCompleteDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-600/40 bg-slate-900 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-50">
              {t("events.completeEntireEventTitle")}
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {t("events.completeEventWarning")}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <SecondaryButton
                type="button"
                onClick={() => onShowCompleteDialog(false)}
                disabled={isCompletingEvent}
              >
                {t("common.cancel")}
              </SecondaryButton>
              <button
                type="button"
                data-testid="confirm-complete-event-button"
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
                disabled={isCompletingEvent}
                onClick={onCompleteEvent}
              >
                {isCompletingEvent
                  ? t("common.loading")
                  : t("events.completeEntireEvent")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </GlassCard>
  );
}
