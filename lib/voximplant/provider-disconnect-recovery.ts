/**
 * Session-room provider disconnect intent and bounded terminal-incident rejoin.
 *
 * A Vox 408 / conference disconnect is not a Session Leave. Auto-rejoin is
 * allowed only for an unexpected terminal conference incident of the current
 * generation while the user is still on the room surface and the Session
 * remains operable. Budget is per terminal incident: success resets the
 * budget so a later independent incident may recover; failure does not loop.
 * SDK ClientState/ConferenceState RECONNECTING owns first-line reconnect.
 */

export type ProviderDisconnectIntent =
  | "none"
  | "explicit_leave"
  | "unmount"
  | "stale_connection"
  | "session_non_operable"
  | "auth_denied"
  | "recovery_teardown";

export type ProviderRecoveryStatus = "idle" | "recovering" | "recovered" | "failed";

/**
 * One terminal incident owns one bounded recovery attempt. SDK RECONNECTING
 * after begin() pauses the same attempt; it must not become a second
 * incident or a failed already_in_flight result.
 */
export type TerminalRecoveryAttemptPhase =
  | "ready"
  | "active"
  | "paused_for_sdk_reconnect"
  | "resuming"
  | "succeeded"
  | "failed";

export type ProviderDisconnectKind = "expected" | "unexpected" | "ignore_stale_generation";

export type SessionCloseForRejoin = {
  isClosed: boolean;
  closeMessageKey?: string | null;
};

/**
 * Debrief after a normal FINISH still occupies the room. Organizer/event
 * close does not. This is a client projection of existing close-state fields,
 * not a new persisted Session flag.
 */
export function isSessionOperableForProviderRejoin(
  closeState: SessionCloseForRejoin | null | undefined,
): boolean {
  if (!closeState || !closeState.isClosed) return true;
  return closeState.closeMessageKey === "join.sessionFinishedMessage";
}

export function classifyProviderDisconnect(input: {
  intent: ProviderDisconnectIntent;
  eventGeneration: number;
  currentGeneration: number;
  mounted: boolean;
  stale: boolean;
  sessionOperable: boolean;
}): ProviderDisconnectKind {
  if (input.eventGeneration !== input.currentGeneration) {
    return "ignore_stale_generation";
  }
  if (
    input.intent === "explicit_leave" ||
    input.intent === "unmount" ||
    input.intent === "stale_connection" ||
    input.intent === "session_non_operable" ||
    input.intent === "auth_denied" ||
    input.intent === "recovery_teardown" ||
    !input.mounted ||
    input.stale ||
    !input.sessionOperable
  ) {
    return "expected";
  }
  return "unexpected";
}

export type BoundedRejoinDecision = {
  shouldRejoin: boolean;
  reason:
    | "unexpected_current_generation"
    | "expected_disconnect"
    | "stale_generation"
    | "already_consumed"
    | "already_in_flight";
};

export function createBoundedProviderRejoin() {
  let status: ProviderRecoveryStatus = "idle";
  let attempt: TerminalRecoveryAttemptPhase = "ready";

  return {
    getStatus(): ProviderRecoveryStatus {
      return status;
    },
    getAttempt(): TerminalRecoveryAttemptPhase {
      return attempt;
    },
    isPaused(): boolean {
      return attempt === "paused_for_sdk_reconnect";
    },
    decide(kind: ProviderDisconnectKind): BoundedRejoinDecision {
      if (kind === "ignore_stale_generation") {
        return { shouldRejoin: false, reason: "stale_generation" };
      }
      if (kind !== "unexpected") {
        return { shouldRejoin: false, reason: "expected_disconnect" };
      }
      if (status === "recovering") {
        return { shouldRejoin: false, reason: "already_in_flight" };
      }
      if (status === "failed") {
        return { shouldRejoin: false, reason: "already_consumed" };
      }
      return { shouldRejoin: true, reason: "unexpected_current_generation" };
    },
    begin(): ProviderRecoveryStatus {
      status = "recovering";
      attempt = "active";
      return status;
    },
    pause(): TerminalRecoveryAttemptPhase {
      if (status === "recovering" && (attempt === "active" || attempt === "resuming")) {
        attempt = "paused_for_sdk_reconnect";
      }
      return attempt;
    },
    resume(): boolean {
      if (attempt !== "paused_for_sdk_reconnect") return false;
      attempt = "resuming";
      return true;
    },
    succeed(): ProviderRecoveryStatus {
      // Independent later terminal incidents may recover again.
      status = "recovered";
      attempt = "succeeded";
      return status;
    },
    fail(): ProviderRecoveryStatus {
      status = "failed";
      attempt = "failed";
      return status;
    },
    cancel(): void {
      if (status !== "recovering") return;
      status = "idle";
      attempt = "ready";
    },
  };
}

export function shouldIgnoreProviderCallback(input: {
  eventGeneration: number;
  currentGeneration: number;
  stale?: boolean;
  mounted?: boolean;
}): boolean {
  if (input.mounted === false) return true;
  if (input.stale) return true;
  return input.eventGeneration !== input.currentGeneration;
}

export function isMediaRecoveryClassification(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return (
    reason.startsWith("media_recovery_failed:") ||
    reason === "media_recovery_failed:ReInviteTimeout"
  );
}

export function isLocalMediaDeviceClassification(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return reason.startsWith("local_media_device_failure");
}

/**
 * Exactly-once ownership of a terminal Conference incident that arrived
 * while SDK reconnect was still in progress. The first retained incident
 * wins; Leave/stale/unmount cancel it; take() yields it once.
 */
export type PendingTerminalRecoveryIncident = {
  generation: number;
  reason: string;
};

export function retainPendingTerminalIncident(
  current: PendingTerminalRecoveryIncident | null,
  next: PendingTerminalRecoveryIncident,
): PendingTerminalRecoveryIncident {
  return current ?? next;
}

export function takePendingTerminalIncident(
  current: PendingTerminalRecoveryIncident | null,
): {
  incident: PendingTerminalRecoveryIncident | null;
  remaining: null;
} {
  return { incident: current, remaining: null };
}

export function shouldCancelPendingTerminalIncident(input: {
  stale: boolean;
  mounted: boolean;
  intent: ProviderDisconnectIntent;
  sessionOperable: boolean;
}): boolean {
  if (!input.mounted || input.stale || !input.sessionOperable) return true;
  return (
    input.intent === "explicit_leave" ||
    input.intent === "unmount" ||
    input.intent === "stale_connection" ||
    input.intent === "session_non_operable" ||
    input.intent === "auth_denied"
  );
}
