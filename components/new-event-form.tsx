"use client";

import { useActionState } from "react";

import {
  createTrainingEvent,
  type CreateEventState,
} from "@/app/actions/events";
import { PageHeader } from "@/components/page-header";
import {
  GradientButton,
  SecondaryButton,
  SecondaryButtonLink,
} from "@/components/ui/buttons";
import {
  alertErrorClassName,
  errorClassName,
  hintClassName,
  inputClassName,
  labelClassName,
} from "@/components/ui/form-styles";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import { useI18n } from "@/lib/i18n/useI18n";

const initialState: CreateEventState = {};

export function NewEventForm() {
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState(
    createTrainingEvent,
    initialState,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("events.newTrainingEvent")}
        description={t("events.newTrainingEventDescription")}
      />

      <form action={formAction} className="max-w-2xl space-y-6">
        {state.errors?.form ? (
          <div className={alertErrorClassName}>
            {state.errors.form.map((message) => tv(message)).join(", ")}
          </div>
        ) : null}

        <GlassCard>
          <GlassCardHeader>
            <h2 className="text-base font-semibold text-slate-50">
              {t("events.eventDetails")}
            </h2>
          </GlassCardHeader>
          <GlassCardContent className="space-y-4">
            <div>
              <label className={labelClassName} htmlFor="hostDisplayName">
                {t("events.hostDisplayName")}
              </label>
              <input
                id="hostDisplayName"
                name="hostDisplayName"
                required
                autoComplete="name"
                className={inputClassName(Boolean(state.errors?.hostDisplayName))}
              />
              {state.errors?.hostDisplayName ? (
                <p className={errorClassName}>
                  {state.errors.hostDisplayName.map((key) => tv(key)).join(", ")}
                </p>
              ) : null}
            </div>

            <div>
              <label className={labelClassName} htmlFor="title">
                {t("common.title")}
              </label>
              <input
                id="title"
                name="title"
                data-testid="event-title-input"
                required
                className={inputClassName(Boolean(state.errors?.title))}
              />
              {state.errors?.title ? (
                <p className={errorClassName}>
                  {state.errors.title.map((key) => tv(key)).join(", ")}
                </p>
              ) : null}
            </div>

            <div>
              <label className={labelClassName} htmlFor="description">
                {t("events.descriptionLabel")}
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                className={inputClassName(false)}
              />
            </div>

            <div>
              <label className={labelClassName} htmlFor="scheduledAt">
                {t("events.scheduledAt")}
              </label>
              <input
                id="scheduledAt"
                name="scheduledAt"
                type="datetime-local"
                className={inputClassName(false)}
              />
              <p className={hintClassName}>{t("events.scheduledAtHint")}</p>
            </div>

            <div>
              <label className={labelClassName} htmlFor="estimatedEventDurationMinutes">
                {t("common.eventDuration")}
              </label>
              <input
                id="estimatedEventDurationMinutes"
                name="estimatedEventDurationMinutes"
                type="number"
                min={1}
                max={480}
                defaultValue={120}
                className={inputClassName(
                  Boolean(state.errors?.estimatedEventDurationMinutes),
                )}
              />
              <p className={hintClassName}>{t("common.eventDurationHint")}</p>
              {state.errors?.estimatedEventDurationMinutes ? (
                <p className={errorClassName}>
                  {state.errors.estimatedEventDurationMinutes
                    .map((key) => tv(key))
                    .join(", ")}
                </p>
              ) : null}
            </div>
          </GlassCardContent>
        </GlassCard>

        <div className="flex flex-wrap gap-3">
          <GradientButton
            type="submit"
            name="afterCreate"
            value="list"
            data-testid="create-event-button"
            disabled={isPending}
          >
            {isPending ? t("common.creating") : t("events.createEvent")}
          </GradientButton>
          <SecondaryButton
            type="submit"
            name="afterCreate"
            value="lobby"
            data-testid="create-event-open-lobby-button"
            disabled={isPending}
          >
            {isPending ? t("common.creating") : t("events.createAndOpenLobby")}
          </SecondaryButton>
          <SecondaryButtonLink href="/events">{t("common.cancel")}</SecondaryButtonLink>
        </div>
      </form>
    </div>
  );
}
