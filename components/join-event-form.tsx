"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { joinTrainingEvent, type JoinEventState } from "@/app/actions/events";
import { LanguageSwitcher } from "@/components/language-switcher";
import { RejoinNavLink } from "@/components/rejoin-page-view";
import { BrandLogo } from "@/components/ui/brand-logo";
import { GradientButton } from "@/components/ui/buttons";
import {
  alertErrorClassName,
  errorClassName,
  inputClassName,
  labelClassName,
} from "@/components/ui/form-styles";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import {
  getEventParticipantTokenForEvent,
  getValidRecoveryContext,
} from "@/lib/rejoin/recovery-storage";
import { useI18n } from "@/lib/i18n/useI18n";

const initialState: JoinEventState = {};

type StoredParticipant = {
  participantToken: string;
  displayName: string;
};

type JoinEventFormProps = {
  eventId: string;
  eventTitle: string;
};

export function JoinEventForm({ eventId, eventTitle }: JoinEventFormProps) {
  const router = useRouter();
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState(
    joinTrainingEvent,
    initialState,
  );
  const [storedParticipant, setStoredParticipant] =
    useState<StoredParticipant | null>(null);
  const [isValidatingStored, setIsValidatingStored] = useState(true);
  const [isRejoining, setIsRejoining] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function validateStoredParticipant() {
      const recovery = getValidRecoveryContext();
      const participantToken =
        recovery?.eventId === eventId
          ? recovery.participantToken
          : getEventParticipantTokenForEvent(eventId);

      if (!participantToken) {
        if (!cancelled) {
          setStoredParticipant(null);
          setIsValidatingStored(false);
        }
        return;
      }

      try {
        const response = await fetch("/api/rejoin/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "EVENT_LOBBY",
            eventId,
            participantToken,
            hostToken: recovery?.hostToken,
          }),
        });

        const payload = (await response.json()) as {
          valid: boolean;
          displayName?: string;
        };

        if (!cancelled) {
          if (payload.valid && payload.displayName) {
            setStoredParticipant({
              participantToken,
              displayName: payload.displayName,
            });
          } else {
            setStoredParticipant(null);
          }

          setIsValidatingStored(false);
        }
      } catch {
        if (!cancelled) {
          setStoredParticipant(null);
          setIsValidatingStored(false);
        }
      }
    }

    void validateStoredParticipant();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const handleRejoinLobby = () => {
    if (!storedParticipant) {
      return;
    }

    setIsRejoining(true);

    const params = new URLSearchParams({
      participantToken: storedParticipant.participantToken,
    });

    router.push(`/events/${eventId}/lobby?${params.toString()}`);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#020617] px-4 py-12">
      <div className="mb-8 flex w-full max-w-md items-center justify-between">
        <BrandLogo size="md" href={undefined} />
        <div className="flex items-center gap-4">
          <RejoinNavLink />
          <LanguageSwitcher />
        </div>
      </div>

      <GlassCard elevated className="w-full max-w-md">
        <GlassCardContent className="space-y-6 p-6 sm:p-8">
          <div className="space-y-1 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-400/80">
              {t("events.joinEvent")}
            </p>
            <h1 className="text-xl font-bold text-slate-50">{eventTitle}</h1>
          </div>

          {isValidatingStored ? (
            <p className="text-center text-sm text-slate-400">{t("common.loading")}…</p>
          ) : storedParticipant ? (
            <div className="space-y-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <p className="text-sm text-slate-200">
                {t("rejoin.alreadyJoinedEvent", {
                  name: storedParticipant.displayName,
                })}
              </p>
              <GradientButton
                type="button"
                className="w-full"
                disabled={isRejoining}
                onClick={handleRejoinLobby}
              >
                {isRejoining ? t("common.loading") : t("rejoin.rejoinLobby")}
              </GradientButton>
              <p className="text-center text-xs text-slate-500">
                {t("rejoin.orJoinAsSomeoneElse")}
              </p>
            </div>
          ) : null}

          {state.errors?.form ? (
            <div className={alertErrorClassName}>
              {state.errors.form.map((key) => tv(key)).join(", ")}
            </div>
          ) : null}

          <form action={formAction} className="space-y-4">
            <input type="hidden" name="eventId" value={eventId} />

            <div>
              <label className={labelClassName} htmlFor="displayName">
                {t("events.enterYourName")}
              </label>
              <input
                id="displayName"
                name="displayName"
                required={!storedParticipant}
                autoComplete="name"
                className={inputClassName(Boolean(state.errors?.displayName))}
              />
              {state.errors?.displayName ? (
                <p className={errorClassName}>
                  {state.errors.displayName.map((key) => tv(key)).join(", ")}
                </p>
              ) : null}
            </div>

            <div>
              <label className={labelClassName} htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                className={inputClassName(false)}
              />
            </div>

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
                    <input type="radio" name="preference" value={value} defaultChecked={value === "UNDECIDED"} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <GradientButton type="submit" disabled={isPending} className="w-full">
              {isPending ? t("common.loading") : t("events.joinEvent")}
            </GradientButton>
          </form>

          <p className="text-center text-xs text-slate-500">
            <Link href="/rejoin" className="text-cyan-400 hover:text-cyan-300">
              {t("rejoin.openRejoinPage")}
            </Link>
          </p>
        </GlassCardContent>
      </GlassCard>
    </div>
  );
}
