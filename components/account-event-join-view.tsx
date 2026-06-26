"use client";

import { useActionState } from "react";

import { joinTrainingEvent, type JoinEventState } from "@/app/actions/events";
import { BrandLogo } from "@/components/ui/brand-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { GradientButton } from "@/components/ui/buttons";
import {
  alertErrorClassName,
  labelClassName,
} from "@/components/ui/form-styles";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import { useI18n } from "@/lib/i18n/useI18n";

const initialState: JoinEventState = {};

type AccountEventJoinViewProps = {
  eventId: string;
  eventTitle: string;
};

export function AccountEventJoinView({
  eventId,
  eventTitle,
}: AccountEventJoinViewProps) {
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState(
    joinTrainingEvent,
    initialState,
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#020617] px-4 py-12">
      <div className="mb-8 flex w-full max-w-md items-center justify-between">
        <BrandLogo size="md" href={undefined} />
        <LanguageSwitcher />
      </div>

      <GlassCard elevated className="w-full max-w-md">
        <GlassCardContent className="space-y-6 p-6 sm:p-8">
          <div className="space-y-1 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-400/80">
              {t("events.joinEvent")}
            </p>
            <h1 className="text-xl font-bold text-slate-50">{eventTitle}</h1>
          </div>

          {state.errors?.form ? (
            <div className={alertErrorClassName}>
              {state.errors.form.map((key) => tv(key)).join(", ")}
            </div>
          ) : null}

          <form action={formAction} className="space-y-4">
            <input type="hidden" name="eventId" value={eventId} />

            <div>
              <p className={labelClassName}>{t("events.yourPreference")}</p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["UNDECIDED", t("events.undecided")],
                    ["PLAY", t("events.wantToPlay")],
                    ["OBSERVE", t("events.wantToObserve")],
                    ["FACILITATE", t("events.canFacilitate")],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600/40 bg-slate-900/50 px-3 py-2 text-sm text-slate-200"
                  >
                    <input
                      type="radio"
                      name="preference"
                      value={value}
                      defaultChecked={value === "UNDECIDED"}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <GradientButton
              type="submit"
              data-testid="join-event-button"
              disabled={isPending}
              className="w-full"
            >
              {isPending ? t("common.loading") : t("events.joinEvent")}
            </GradientButton>
          </form>
        </GlassCardContent>
      </GlassCard>
    </div>
  );
}
