"use client";

import { Badge } from "@/components/badge";
import { EventPresenceIndicator } from "@/components/event-presence-indicator";
import { MediaStatusIconBadge } from "@/components/media-status-icon";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/useI18n";

type CompactParticipantType = "FACILITATOR" | "PARTICIPANT" | "OBSERVER" | string;
type EventPresenceStatus =
  | "INVITED_NEVER_CONNECTED"
  | "ONLINE"
  | "RECENTLY_DISCONNECTED"
  | "OFFLINE";

type CompactPersonStatusProps = {
  displayName: string;
  caseRoleName?: string | null;
  participantType?: CompactParticipantType | null;
  slotLabel?: string | null;
  assignmentLabel?: string | null;
  preferenceLabel?: string | null;
  isHost?: boolean;
  presenceStatus?: EventPresenceStatus | null;
  locationLabel?: string | null;
  micEnabled?: boolean | null;
  cameraEnabled?: boolean | null;
  className?: string;
  testId?: string;
};

function participantTypeLabel(
  participantType: CompactParticipantType | null | undefined,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (!participantType) return null;
  if (
    participantType === "FACILITATOR" ||
    participantType === "PARTICIPANT" ||
    participantType === "OBSERVER"
  ) {
    return t(`participantType.${participantType}` as
      | "participantType.FACILITATOR"
      | "participantType.PARTICIPANT"
      | "participantType.OBSERVER");
  }
  return participantType;
}

export function CompactPersonStatus({
  displayName,
  caseRoleName,
  participantType,
  slotLabel,
  assignmentLabel,
  preferenceLabel,
  isHost = false,
  presenceStatus,
  locationLabel,
  micEnabled,
  cameraEnabled,
  className,
  testId,
}: CompactPersonStatusProps) {
  const { t } = useI18n();
  const participantTypeText = participantTypeLabel(participantType, t);
  const roleParts = [caseRoleName, slotLabel, participantTypeText].filter(
    (part): part is string => Boolean(part),
  );
  const cameraLabel =
    cameraEnabled == null
      ? null
      : cameraEnabled
        ? t("events.cameraOn")
        : t("events.cameraOff");
  const micLabel =
    micEnabled == null
      ? null
      : micEnabled
        ? t("events.microphoneOn")
        : t("events.microphoneMuted");
  const accessibleLabel = [
    displayName,
    ...roleParts,
    assignmentLabel,
    preferenceLabel,
    isHost ? t("events.hostLabel") : null,
    locationLabel,
    cameraLabel,
    micLabel,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <div
      className={cn("min-w-0", className)}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      data-testid={testId}
    >
      <p className="truncate text-sm font-semibold text-slate-100" title={displayName}>
        {displayName}
      </p>
      {roleParts.length > 0 || preferenceLabel ? (
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {[...roleParts, preferenceLabel].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {isHost ? (
          <Badge variant="info" className="px-2 py-0 text-[10px]">
            {t("events.hostLabel")}
          </Badge>
        ) : null}
        {assignmentLabel ? (
          <Badge variant="success" className="max-w-full px-2 py-0 text-[10px]">
            <span className="truncate">{assignmentLabel}</span>
          </Badge>
        ) : null}
        {presenceStatus ? (
          <EventPresenceIndicator status={presenceStatus} compact />
        ) : null}
        {locationLabel ? (
          <span className="rounded-full border border-slate-600/35 bg-slate-900/55 px-2 py-0.5 text-[10px] text-slate-300">
            {locationLabel}
          </span>
        ) : null}
        {cameraLabel ? (
          <MediaStatusIconBadge
            kind="camera"
            status={cameraEnabled ? "on" : "off"}
            label={cameraLabel}
            className="h-5 w-5"
            testId="compact-person-camera-status-icon"
          />
        ) : null}
        {micLabel ? (
          <MediaStatusIconBadge
            kind="mic"
            status={micEnabled ? "on" : "off"}
            label={micLabel}
            className="h-5 w-5"
            testId="compact-person-mic-status-icon"
          />
        ) : null}
      </div>
    </div>
  );
}
