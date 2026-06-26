"use client";

import { useActionState, useMemo, useState } from "react";

import {
  createTrainingEvent,
  type CreateEventState,
} from "@/app/actions/events";
import { PeoplePicker } from "@/components/people-picker";
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

type UserOption = {
  id: string;
  name: string | null;
  email: string;
};

type NewEventFormProps = {
  currentUserId: string;
  currentUserEmail: string;
  activeUsers: UserOption[];
  canAssignFacilitator: boolean;
};

function userLabel(user: UserOption): string {
  return user.name ? `${user.name} (${user.email})` : user.email;
}

export function NewEventForm({
  currentUserId,
  currentUserEmail,
  activeUsers,
  canAssignFacilitator,
}: NewEventFormProps) {
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState(
    createTrainingEvent,
    initialState,
  );
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");
  const [facilitatorUserId, setFacilitatorUserId] = useState(currentUserId);
  const selfOption = useMemo(
    () =>
      activeUsers.find((user) => user.id === currentUserId) ?? {
        id: currentUserId,
        name: null,
        email: currentUserEmail,
      },
    [activeUsers, currentUserEmail, currentUserId],
  );
  const facilitatorOptions = canAssignFacilitator ? activeUsers : [selfOption];

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

        {/* Hidden fields for controlled state */}
        <input type="hidden" name="visibility" value={visibility} />
        <input type="hidden" name="facilitatorUserId" value={facilitatorUserId} />

        {/* Facilitator selection */}
        <GlassCard>
          <GlassCardHeader>
            <h2 className="text-base font-semibold text-slate-50">
              {t("visibility.facilitatorOrganizer")}
            </h2>
          </GlassCardHeader>
          <GlassCardContent className="space-y-4">
            <div>
              <label className={labelClassName} htmlFor="facilitatorUserIdSelector">
                {t("visibility.facilitatorOrganizer")}
              </label>
              <select
                id="facilitatorUserIdSelector"
                value={facilitatorUserId}
                onChange={(event) => setFacilitatorUserId(event.target.value)}
                className={inputClassName(false)}
                disabled={!canAssignFacilitator}
              >
                {facilitatorOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {userLabel(user)}
                    {user.id === currentUserId ? " (you)" : ""}
                  </option>
                ))}
              </select>
              <p className={hintClassName}>
                {canAssignFacilitator
                  ? t("visibility.selectFacilitatorHint")
                  : t("visibility.facilitatorSelfOnlyHint")}
              </p>
            </div>
          </GlassCardContent>
        </GlassCard>

        <GlassCard>
          <GlassCardHeader>
            <h2 className="text-base font-semibold text-slate-50">
              {t("events.eventDetails")}
            </h2>
          </GlassCardHeader>
          <GlassCardContent className="space-y-4">
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

        {/* Visibility + Invitees */}
        <GlassCard>
          <GlassCardHeader>
            <h2 className="text-base font-semibold text-slate-50">
              {t("visibility.visibilityLabel")}
            </h2>
          </GlassCardHeader>
          <GlassCardContent className="space-y-4">
            <div className="space-y-2">
              {(["PRIVATE", "PUBLIC"] as const).map((v) => (
                <label
                  key={v}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    visibility === v
                      ? "border-cyan-500/40 bg-cyan-500/5"
                      : "border-slate-600/40 bg-slate-900/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="_visibilityRadio"
                    value={v}
                    checked={visibility === v}
                    onChange={() => setVisibility(v)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {v === "PUBLIC" ? t("visibility.public") : t("visibility.private")}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {v === "PUBLIC"
                        ? t("visibility.publicOption")
                        : t("visibility.privateOption")}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            <div>
              <p className={labelClassName}>{t("visibility.inviteesLabel")}</p>
              <PeoplePicker
                excludeUserIds={[currentUserId]}
                userFieldName="invitedUserId"
                emailFieldName="invitedEmail"
              />
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
