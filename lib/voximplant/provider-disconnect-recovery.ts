/**
 * Session-room provider disconnect intent and one-shot bounded rejoin.
 *
 * A Vox 408 / conference disconnect is not a Session Leave. Auto-rejoin is
 * allowed only for an unexpected disconnect of the current generation while
 * the user is still on the room surface and the Session remains operable.
 * One attempt per mounted room instance — no retry storm.
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
  let consumed = false;

  return {
    getStatus(): ProviderRecoveryStatus {
      return status;
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
      if (consumed || status === "failed" || status === "recovered") {
        return { shouldRejoin: false, reason: "already_consumed" };
      }
      return { shouldRejoin: true, reason: "unexpected_current_generation" };
    },
    begin(): ProviderRecoveryStatus {
      consumed = true;
      status = "recovering";
      return status;
    },
    succeed(): ProviderRecoveryStatus {
      status = "recovered";
      return status;
    },
    fail(): ProviderRecoveryStatus {
      status = "failed";
      return status;
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
