"use client";

import { useMemo, useState } from "react";

import { DifficultyBadge } from "@/components/badge";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import { EventCaseDetailsModal } from "@/components/event-case-details-modal";
import { SecondaryButton } from "@/components/ui/buttons";
import { inputClassName } from "@/components/ui/form-styles";
import type { PublicCaseSummary } from "@/lib/event-case-public";
import { filterEventCases } from "@/lib/event-case-search";
import { useI18n } from "@/lib/i18n/useI18n";

type EventCaseLibraryProps = {
  cases: PublicCaseSummary[];
  selectedCaseId: string | null;
  onUseCase: (negotiationCase: PublicCaseSummary) => void;
};

export function EventCaseLibrary({
  cases,
  selectedCaseId,
  onUseCase,
}: EventCaseLibraryProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<"ALL" | "EN" | "RU">("ALL");
  const [difficulty, setDifficulty] = useState<"ALL" | "EASY" | "MEDIUM" | "HARD">(
    "ALL",
  );
  const [detailsCase, setDetailsCase] = useState<PublicCaseSummary | null>(null);

  const filteredCases = useMemo(
    () => filterEventCases(cases, { query, language, difficulty }),
    [cases, difficulty, language, query],
  );

  return (
    <div className="space-y-3" data-testid="case-library-section">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {t("events.caseLibrary")}
      </p>

      <div>
        <label className="sr-only" htmlFor="case-search-input">
          {t("events.searchCases")}
        </label>
        <input
          id="case-search-input"
          data-testid="case-search-input"
          type="search"
          className={inputClassName(false)}
          placeholder={t("events.searchCases")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          data-testid="case-language-filter"
          className={`${inputClassName(false)} min-w-0 flex-1 text-xs`}
          value={language}
          onChange={(event) =>
            setLanguage(event.target.value as "ALL" | "EN" | "RU")
          }
        >
          <option value="ALL">{t("events.allLanguages")}</option>
          <option value="EN">EN</option>
          <option value="RU">RU</option>
        </select>
        <select
          data-testid="case-difficulty-filter"
          className={`${inputClassName(false)} min-w-0 flex-1 text-xs`}
          value={difficulty}
          onChange={(event) =>
            setDifficulty(event.target.value as "ALL" | "EASY" | "MEDIUM" | "HARD")
          }
        >
          <option value="ALL">{t("events.allDifficulties")}</option>
          <option value="EASY">{t("difficulty.EASY")}</option>
          <option value="MEDIUM">{t("difficulty.MEDIUM")}</option>
          <option value="HARD">{t("difficulty.HARD")}</option>
        </select>
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {filteredCases.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-600/40 px-3 py-6 text-center">
            <p className="text-sm font-medium text-slate-300">
              {t("events.noCasesFound")}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t("events.noCasesFoundHint")}
            </p>
          </div>
        ) : (
          filteredCases.map((negotiationCase) => (
            <article
              key={negotiationCase.id}
              data-testid="case-card"
              className={`rounded-lg border px-3 py-3 transition ${
                selectedCaseId === negotiationCase.id
                  ? "border-cyan-500/40 bg-cyan-500/10"
                  : "border-slate-600/30 bg-slate-900/50"
              }`}
            >
              <p className="text-sm font-medium text-slate-100">
                {negotiationCase.title}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <CaseLanguageBadge caseLanguage={negotiationCase.caseLanguage} />
                <DifficultyBadge difficulty={negotiationCase.difficulty} />
                <span className="text-[10px] text-slate-400">
                  {t("common.preparationDurationValue", {
                    minutes: negotiationCase.defaultPreparationDurationMinutes,
                  })}
                </span>
                <span className="text-[10px] text-slate-400">
                  {t("common.negotiationDurationValue", {
                    minutes: negotiationCase.defaultDurationMinutes,
                  })}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                <span className="font-medium">{t("cases.roles")}: </span>
                {negotiationCase.roleNames.join(", ")}
              </p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
                {negotiationCase.businessContext}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <SecondaryButton
                  type="button"
                  data-testid="case-details-button"
                  className="px-2 py-1 text-xs"
                  onClick={() => setDetailsCase(negotiationCase)}
                >
                  {t("events.caseDetails")}
                </SecondaryButton>
                <SecondaryButton
                  type="button"
                  data-testid="use-case-button"
                  className="px-2 py-1 text-xs"
                  onClick={() => onUseCase(negotiationCase)}
                >
                  {t("events.useThisCase")}
                </SecondaryButton>
              </div>
            </article>
          ))
        )}
      </div>

      <EventCaseDetailsModal
        open={detailsCase !== null}
        negotiationCase={detailsCase}
        onClose={() => setDetailsCase(null)}
        onUseCase={() => {
          if (detailsCase) {
            onUseCase(detailsCase);
          }
          setDetailsCase(null);
        }}
      />
    </div>
  );
}
