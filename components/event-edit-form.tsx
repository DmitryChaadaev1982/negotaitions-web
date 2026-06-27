"use client";

import { useActionState, useMemo, useState } from "react";

import {
  updateTrainingEvent,
  type UpdateEventState,
} from "@/app/actions/events";
import { PeoplePicker } from "@/components/people-picker";
import { PageHeader } from "@/components/page-header";
import {
  GradientButton,
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
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { useI18n } from "@/lib/i18n/useI18n";
import { getSupportedTimeZones } from "@/lib/timezones";

const initialState: UpdateEventState = {};

type UserOption = {
  id: string;
  name: string | null;
  email: string;
};


type EventEditFormProps = {
  event: {
    id: string;
    title: string;
    description: string | null;
    scheduledAt: Date | null;
    timeZone: string;
    estimatedEventDurationSeconds: number | null;
    visibility: string;
    facilitatorUserId: string | null;
    hostUserId: string | null;
    status: string;
  };
  currentUserId: string;
  currentUserEmail: string;
  activeUsers: UserOption[];
  canAssignFacilitator: boolean;
  initialInvitedUsers: UserOption[];
  initialInvitedEmails: string[];
};

function userLabel(user: UserOption): string {
  return user.name ? `${user.name} (${user.email})` : user.email;
}

function toDatetimeLocalValue(date: Date | null, timeZone: string): string {
  if (!date) return "";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(date));
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${lookup("year")}-${lookup("month")}-${lookup("day")}T${lookup("hour")}:${lookup("minute")}`;
}

export function EventEditForm({
  event,
  currentUserId,
  currentUserEmail,
  activeUsers,
  canAssignFacilitator,
  initialInvitedUsers,
  initialInvitedEmails,
}: EventEditFormProps) {
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState(updateTrainingEvent, initialState);
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">(
    event.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE",
  );
  const [facilitatorUserId, setFacilitatorUserId] = useState(
    event.facilitatorUserId ?? currentUserId,
  );
  const [ownerUserId, setOwnerUserId] = useState(
    event.hostUserId ?? currentUserId,
  );
  const [timeZone, setTimeZone] = useState(event.timeZone);

  const selfOption = useMemo(
    () =>
      activeUsers.find((u) => u.id === currentUserId) ?? {
        id: currentUserId,
        name: null,
        email: currentUserEmail,
      },
    [activeUsers, currentUserId, currentUserEmail],
  );
  const facilitatorOptions = canAssignFacilitator ? activeUsers : [selfOption];
  const ownerOptions = canAssignFacilitator ? activeUsers : [selfOption];
  const timeZoneOptions = useMemo(() => getSupportedTimeZones(), []);

  const defaultDurationMinutes = event.estimatedEventDurationSeconds
    ? secondsToDisplayMinutes(event.estimatedEventDurationSeconds)
    : 120;

  const defaultScheduledAt = toDatetimeLocalValue(event.scheduledAt, timeZone);


  return (
    <div className="space-y-8">
      <PageHeader
        title={t("events.editEventTitle")}
        description={t("events.editEventPageDescription")}
      />

      {state.success ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {t("events.eventSaved")}
        </div>
      ) : null}

      <form action={formAction} className="max-w-2xl space-y-6">
        <input type="hidden" name="eventId" value={event.id} />
        <input type="hidden" name="visibility" value={visibility} />
        <input type="hidden" name="facilitatorUserId" value={facilitatorUserId} />
        <input type="hidden" name="ownerUserId" value={ownerUserId} />
        <input type="hidden" name="timeZone" value={timeZone} />

        {state.errors?.form ? (
          <div className={alertErrorClassName}>
            {state.errors.form.map((key) => tv(key)).join(", ")}
          </div>
        ) : null}

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
                onChange={(e) => setFacilitatorUserId(e.target.value)}
                className={inputClassName(false)}
                disabled={!canAssignFacilitator}
              >
                {facilitatorOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {userLabel(u)}
                    {u.id === currentUserId ? " (you)" : ""}
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
                defaultValue={event.title}
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
                defaultValue={event.description ?? ""}
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
                defaultValue={defaultScheduledAt}
                className={inputClassName(false)}
              />
              <p className={hintClassName}>{t("events.scheduledAtHint")}</p>
            </div>

            <div>
              <label className={labelClassName} htmlFor="timeZone">
                {t("events.timeZone")}
              </label>
              <select
                id="timeZone"
                value={timeZone}
                onChange={(event) => setTimeZone(event.target.value)}
                className={inputClassName(Boolean(state.errors?.timeZone))}
              >
                {timeZoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className={hintClassName}>{t("events.timeZoneHint")}</p>
              {state.errors?.timeZone ? (
                <p className={errorClassName}>
                  {state.errors.timeZone.map((key) => tv(key)).join(", ")}
                </p>
              ) : null}
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
                defaultValue={defaultDurationMinutes}
                className={inputClassName(Boolean(state.errors?.estimatedEventDurationMinutes))}
              />
              <p className={hintClassName}>{t("common.eventDurationHint")}</p>
              {state.errors?.estimatedEventDurationMinutes ? (
                <p className={errorClassName}>
                  {state.errors.estimatedEventDurationMinutes.map((key) => tv(key)).join(", ")}
                </p>
              ) : null}
            </div>
          </GlassCardContent>
        </GlassCard>

        {/* Visibility + Owner + Invitees */}
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

            {/* Owner field — placed near visibility per Phase 6.11A */}
            <div>
              <label className={labelClassName} htmlFor="ownerUserIdDisplay">
                {t("visibility.ownerLabel")}
              </label>
              {canAssignFacilitator ? (
                <>
                  <select
                    id="ownerUserIdDisplay"
                    value={ownerUserId}
                    onChange={(e) => setOwnerUserId(e.target.value)}
                    className={inputClassName(false)}
                  >
                    {ownerOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {userLabel(u)}
                        {u.id === currentUserId ? " (you)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className={hintClassName}>{t("visibility.ownerSelectHint")}</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm text-slate-300">
                    {selfOption.name
                      ? `${selfOption.name} (${selfOption.email})`
                      : selfOption.email}
                  </p>
                  <p className={hintClassName}>{t("visibility.ownerSelfOnlyHint")}</p>
                </>
              )}
              {state.errors?.form?.includes("ownerRequired") ? (
                <p className={errorClassName}>{t("visibility.ownerRequired")}</p>
              ) : null}
            </div>

            <div>
              <p className={labelClassName}>{t("visibility.inviteesLabel")}</p>
              <PeoplePicker
                excludeUserIds={[facilitatorUserId]}
                userFieldName="invitedUserId"
                emailFieldName="invitedEmail"
                initialUsers={initialInvitedUsers}
                initialEmails={initialInvitedEmails}
              />
            </div>
          </GlassCardContent>
        </GlassCard>

        <div className="flex flex-wrap gap-3">
          <GradientButton
            type="submit"
            data-testid="save-event-button"
            disabled={isPending}
          >
            {isPending ? t("events.savingEvent") : t("events.saveEvent")}
          </GradientButton>
          <SecondaryButtonLink href="/events">{t("common.cancel")}</SecondaryButtonLink>
        </div>
      </form>
    </div>
  );
}
