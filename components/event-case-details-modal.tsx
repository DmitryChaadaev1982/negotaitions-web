"use client";

import { useEffect, useId } from "react";

import { DifficultyBadge } from "@/components/badge";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import { GradientButton, SecondaryButton } from "@/components/ui/buttons";
import { cn } from "@/lib/cn";
import type { PublicCaseSummary } from "@/lib/event-case-public";
import { useI18n } from "@/lib/i18n/useI18n";

type EventCaseDetailsModalProps = {
  open: boolean;
  negotiationCase: PublicCaseSummary | null;
  onClose: () => void;
  onUseCase: () => void;
};

export function EventCaseDetailsModal({
  open,
  negotiationCase,
  onClose,
  onUseCase,
}: EventCaseDetailsModalProps) {
  const { t } = useI18n();
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !negotiationCase) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[#020617]/80 backdrop-blur-sm"
        aria-label={t("events.close")}
        onClick={onClose}
      />
      <div
        role="dialog"
        data-testid="case-details-modal"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-700/60 bg-slate-900/95 shadow-2xl shadow-black/50 ring-1 ring-slate-600/30 sm:rounded-xl",
        )}
      >
        <div className="shrink-0 border-b border-slate-700/50 px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-50">
            {negotiationCase.title}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CaseLanguageBadge caseLanguage={negotiationCase.caseLanguage} />
            <DifficultyBadge difficulty={negotiationCase.difficulty} />
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>
              {t("common.preparationDurationValue", {
                minutes: negotiationCase.defaultPreparationDurationMinutes,
              })}
            </span>
            <span>
              {t("common.negotiationDurationValue", {
                minutes: negotiationCase.defaultDurationMinutes,
              })}
            </span>
          </div>

          {negotiationCase.targetSkills ? (
            <div>
              <p className="text-xs font-medium text-slate-400">
                {t("cases.targetSkills")}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-slate-300">
                {negotiationCase.targetSkills}
              </p>
            </div>
          ) : null}

          <div>
            <p className="text-xs font-medium text-slate-400">
              {t("cases.businessContext")}
            </p>
            <p className="mt-1 whitespace-pre-wrap leading-5 text-slate-300">
              {negotiationCase.businessContext}
            </p>
          </div>

          {negotiationCase.publicInstructions ? (
            <div>
              <p className="text-xs font-medium text-slate-400">
                {t("cases.publicInstructions")}
              </p>
              <p className="mt-1 whitespace-pre-wrap leading-5 text-slate-300">
                {negotiationCase.publicInstructions}
              </p>
            </div>
          ) : null}

          <div>
            <p className="text-xs font-medium text-slate-400">{t("cases.roles")}</p>
            <p className="mt-1 text-slate-300">
              {negotiationCase.roleNames.join(", ")}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-400">
              {t("events.caseNegotiationTopic")}
            </p>
            <p className="mt-1 whitespace-pre-wrap leading-5 text-slate-300">
              {negotiationCase.businessContext}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-700/50 px-5 py-4">
          <SecondaryButton type="button" onClick={onClose}>
            {t("events.close")}
          </SecondaryButton>
          <GradientButton type="button" data-testid="use-case-button" onClick={onUseCase}>
            {t("events.useThisCase")}
          </GradientButton>
        </div>
      </div>
    </div>
  );
}
