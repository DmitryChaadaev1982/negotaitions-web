"use client";

import { useI18n } from "@/lib/i18n/useI18n";

type EventPresenceStatus =
  | "IN_LOBBY"
  | "IN_SESSION"
  | "TEMPORARILY_AWAY"
  | "OFFLINE"
  | "INVITED_NOT_CONNECTED";

type EventPresenceIndicatorProps = {
  status: EventPresenceStatus;
  compact?: boolean;
};

function statusTone(status: EventPresenceStatus) {
  if (status === "IN_LOBBY") {
    return {
      dot: "bg-emerald-400",
      text: "text-emerald-300",
      labelKey: "events.presenceInLobby" as const,
    };
  }
  if (status === "IN_SESSION") {
    return {
      dot: "bg-cyan-400",
      text: "text-cyan-300",
      labelKey: "events.presenceInSession" as const,
    };
  }
  if (status === "TEMPORARILY_AWAY") {
    return {
      dot: "bg-amber-400",
      text: "text-amber-300",
      labelKey: "events.presenceTemporarilyAway" as const,
    };
  }
  if (status === "INVITED_NOT_CONNECTED") {
    return {
      dot: "bg-slate-400",
      text: "text-slate-300",
      labelKey: "events.presenceInvitedNeverConnected" as const,
    };
  }
  return {
    dot: "bg-rose-400",
    text: "text-rose-300",
    labelKey: "events.presenceOffline" as const,
  };
}

export function EventPresenceIndicator({
  status,
  compact = false,
}: EventPresenceIndicatorProps) {
  const { t } = useI18n();
  const tone = statusTone(status);
  const label = t(tone.labelKey);

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${compact ? "text-[11px]" : "text-xs"}`}
      title={label}
      aria-label={label}
      data-testid="event-presence-indicator"
      data-presence-status={status}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${tone.dot}`} />
      <span className={tone.text}>{label}</span>
    </span>
  );
}
