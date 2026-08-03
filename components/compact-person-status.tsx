"use client";

import { Badge } from "@/components/badge";
import { EventPresenceIndicator } from "@/components/event-presence-indicator";
import { MediaStatusIconBadge } from "@/components/media-status-icon";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/useI18n";

type CompactParticipantType = "FACILITATOR" | "PARTICIPANT" | "OBSERVER" | string;
type EventPresenceStatus =
  | "IN_LOBBY"
  | "IN_SESSION"
  | "TEMPORARILY_AWAY"
  | "OFFLINE"
  | "INVITED_NOT_CONNECTED";

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
  mediaControls?: {
    mic?: {
      label: string;
      onClick: () => void;
      disabled?: boolean;
      busy?: boolean;
    };
    camera?: {
      label: string;
      onClick: () => void;
      disabled?: boolean;
      busy?: boolean;
    };
  };
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
  mediaControls,
  className,
  testId,
}: CompactPersonStatusProps) {
  const { t } = useI18n();
  const participantTypeText = participantTypeLabel(participantType, t);
  const roleParts = [caseRoleName, slotLabel, participantTypeText].filter(
    (part): part is string => Boolean(part),
  );
  const isLobbyActionable = presenceStatus === "IN_LOBBY";
  const isUnavailable = presenceStatus != null && !isLobbyActionable;
  const cameraUnavailableLabel =
    presenceStatus === "IN_SESSION"
      ? t("events.cameraUnavailableInSession")
      : presenceStatus === "TEMPORARILY_AWAY"
        ? t("events.cameraUnavailableTemporarilyAway")
        : presenceStatus === "INVITED_NOT_CONNECTED"
          ? t("events.cameraUnavailableInvitedNeverConnected")
          : t("events.cameraUnavailableOffline");
  const microphoneUnavailableLabel =
    presenceStatus === "IN_SESSION"
      ? t("events.microphoneUnavailableInSession")
      : presenceStatus === "TEMPORARILY_AWAY"
        ? t("events.microphoneUnavailableTemporarilyAway")
        : presenceStatus === "INVITED_NOT_CONNECTED"
          ? t("events.microphoneUnavailableInvitedNeverConnected")
          : t("events.microphoneUnavailableOffline");
  const cameraLabel =
    isUnavailable
      ? cameraUnavailableLabel
      : cameraEnabled == null
        ? mediaControls?.camera?.label ?? null
        : cameraEnabled
          ? t("events.cameraOn")
          : t("events.cameraOff");
  const micLabel =
    isUnavailable
      ? microphoneUnavailableLabel
      : micEnabled == null
        ? mediaControls?.mic?.label ?? null
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
            status={isUnavailable ? "unknown" : cameraEnabled ? "on" : "off"}
            connectionStatus={isUnavailable ? "disconnected" : "connected"}
            label={mediaControls?.camera?.label ?? cameraLabel}
            className="h-5 w-5"
            testId="compact-person-camera-status-icon"
            onClick={isUnavailable ? undefined : mediaControls?.camera?.onClick}
            disabled={mediaControls?.camera?.disabled}
            busy={mediaControls?.camera?.busy}
            pressed={isUnavailable ? undefined : Boolean(cameraEnabled)}
          />
        ) : null}
        {micLabel ? (
          <MediaStatusIconBadge
            kind="mic"
            status={isUnavailable ? "unknown" : micEnabled ? "on" : "off"}
            connectionStatus={isUnavailable ? "disconnected" : "connected"}
            label={mediaControls?.mic?.label ?? micLabel}
            className="h-5 w-5"
            testId="compact-person-mic-status-icon"
            onClick={isUnavailable ? undefined : mediaControls?.mic?.onClick}
            disabled={mediaControls?.mic?.disabled}
            busy={mediaControls?.mic?.busy}
            pressed={isUnavailable ? undefined : Boolean(micEnabled)}
          />
        ) : null}
      </div>
    </div>
  );
}
