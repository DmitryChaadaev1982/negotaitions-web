"use client";

import { useActionState, useState } from "react";

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

type UserOption = {
  id: string;
  name: string | null;
  email: string;
};

type NewEventFormProps = {
  currentUserId: string;
  activeUsers: UserOption[];
};

function userLabel(user: UserOption): string {
  return user.name ? `${user.name} (${user.email})` : user.email;
}

export function NewEventForm({ currentUserId, activeUsers }: NewEventFormProps) {
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState(
    createTrainingEvent,
    initialState,
  );
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");
  const [selectedInvites, setSelectedInvites] = useState<string[]>([]);

  const toggleInvite = (userId: string) => {
    setSelectedInvites((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  // Users available for invitation (exclude self)
  const invitableUsers = activeUsers.filter((u) => u.id !== currentUserId);

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
        {selectedInvites.map((userId) => (
          <input key={userId} type="hidden" name="invitedUserId" value={userId} />
        ))}

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

        {/* Facilitator selection */}
        <GlassCard>
          <GlassCardHeader>
            <h2 className="text-base font-semibold text-slate-50">
              {t("visibility.selectFacilitator")}
            </h2>
          </GlassCardHeader>
          <GlassCardContent className="space-y-4">
            <div>
              <label className={labelClassName} htmlFor="facilitatorUserId">
                {t("visibility.facilitatorLabel")}
              </label>
              <select
                id="facilitatorUserId"
                name="facilitatorUserId"
                defaultValue={currentUserId}
                className={inputClassName(false)}
              >
                {activeUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {userLabel(user)}
                    {user.id === currentUserId ? " (you)" : ""}
                  </option>
                ))}
              </select>
              <p className={hintClassName}>{t("visibility.selectFacilitatorHint")}</p>
            </div>
          </GlassCardContent>
        </GlassCard>

        {/* Visibility + Invited users */}
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

            {invitableUsers.length > 0 ? (
              <div>
                <p className={labelClassName}>{t("visibility.invitedUsers")}</p>
                <p className="mb-2 text-xs text-amber-400/80">
                  {t("visibility.invitedUsersHint")}
                </p>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-600/40 bg-slate-900/50 p-2">
                  {invitableUsers.map((user) => (
                    <label
                      key={user.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-200 hover:bg-slate-800/60"
                    >
                      <input
                        type="checkbox"
                        checked={selectedInvites.includes(user.id)}
                        onChange={() => toggleInvite(user.id)}
                      />
                      {userLabel(user)}
                    </label>
                  ))}
                </div>
                {selectedInvites.length > 0 ? (
                  <p className="mt-1 text-xs text-cyan-400">
                    {selectedInvites.length} invited
                  </p>
                ) : null}
              </div>
            ) : null}
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
