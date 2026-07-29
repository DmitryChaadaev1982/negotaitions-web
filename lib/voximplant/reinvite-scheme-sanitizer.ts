/**
 * Architecture: docs/architecture/05-voximplant-integration.md
 *
 * Guards the Voximplant WebSDK conference ReInvite path against conference
 * scheme payloads whose `reinviteCauses` reference an endpoint that is absent
 * from the same message's `endpoints` record.
 *
 * Why this exists
 * ---------------
 * `@voximplant/websdk@5.1.0` conference-manager handles a ReInvite like this:
 *
 *     const { reinviteCauses, endpoints } = params.scheme;
 *     for (const cause of reinviteCauses) {
 *       case "vi/conf-info-added":   new Map(Object.entries(endpoints[cause.id].mids))
 *       case "vi/conf-info-updated": const mids = endpoints[cause.id].mids
 *       case "vi/conf-info-removed": endpointManager.removeEndpoint(cause.id)  // tolerates absence
 *     }
 *     reInviteQueue.add(new HandleReInviteConferenceAction(...))  // applies SDP, sends AcceptReInvite
 *
 * The added/updated branches dereference `endpoints[cause.id]` with no guard,
 * even though the removed branch proves a cause id may legitimately have no
 * `endpoints` entry. The SDK protocol type also models only `type: "call"`
 * endpoints, so provider endpoints of other kinds (the VoxEngine conference
 * audio recorder) are announced as a cause but carry no `endpoints` entry.
 *
 * The throw happens before `reInviteQueue.add(...)`, so the whole ReInvite is
 * abandoned: remaining causes are skipped, the SDP offer is never applied and
 * no AcceptReInvite is returned. The affected client then has no working remote
 * media for the rest of the call. This is not cosmetic.
 *
 * Both the offending cause and the record it fails to resolve arrive in one
 * message, so no client-side ordering can prevent it. Dropping the unresolvable
 * cause keeps every resolvable cause and lets the SDP negotiation complete.
 *
 * Removal condition: delete this module once the installed `@voximplant/websdk`
 * guards `endpoints[cause.id]` in `handleCurrentConferenceReInvite`. The
 * `reinvite-scheme-sanitizer.test.ts` harness executes the shipped SDK source
 * and fails when that source changes shape, which is the upgrade tripwire.
 */

export const VI_CONF_INFO_ADDED = "vi/conf-info-added";
export const VI_CONF_INFO_UPDATED = "vi/conf-info-updated";
export const VI_CONF_INFO_REMOVED = "vi/conf-info-removed";

/** Cause events whose SDK branch dereferences `endpoints[cause.id].mids`. */
const ENDPOINT_RESOLVING_EVENTS: ReadonlySet<string> = new Set([
  VI_CONF_INFO_ADDED,
  VI_CONF_INFO_UPDATED,
]);

export type ReInviteCauseLike = {
  event?: unknown;
  id?: unknown;
};

export type ReInviteEndpointInfoLike = {
  mids?: unknown;
};

export type ReInviteSchemeLike = {
  endpoints?: Record<string, ReInviteEndpointInfoLike | null | undefined> | null;
  reinviteCauses?: ReInviteCauseLike[] | null;
};

export type DroppedCauseReason =
  | "no_endpoints_record"
  | "missing_endpoint_entry"
  | "missing_mids"
  | "invalid_cause_id";

export type DroppedReInviteCause = {
  event: string;
  id: string;
  reason: DroppedCauseReason;
};

export type SanitizeReInviteSchemeResult = {
  /** True when at least one cause was removed from `scheme.reinviteCauses`. */
  changed: boolean;
  keptCauseCount: number;
  dropped: DroppedReInviteCause[];
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns null when `endpoints[id]` resolves to an entry the SDK can consume,
 * otherwise the reason it cannot.
 */
function classifyUnresolvableCause(
  endpoints: unknown,
  id: string,
): DroppedCauseReason | null {
  if (!isPlainRecord(endpoints)) return "no_endpoints_record";
  if (!Object.prototype.hasOwnProperty.call(endpoints, id)) return "missing_endpoint_entry";
  const entry = endpoints[id];
  if (!isPlainRecord(entry)) return "missing_endpoint_entry";
  if (!isPlainRecord(entry.mids)) return "missing_mids";
  return null;
}

/**
 * Removes `vi/conf-info-added` / `vi/conf-info-updated` causes that cannot be
 * resolved against the same scheme's `endpoints` record.
 *
 * Mutates `scheme.reinviteCauses` in place because every WebSDK message
 * subscriber shares one params object. Nothing else on the scheme is touched:
 * `endpoints`, `politeIndex`, `sdp` and `headers` stay byte-identical, and
 * `vi/conf-info-removed` causes are always preserved.
 */
export function sanitizeReInviteScheme(
  scheme: ReInviteSchemeLike | null | undefined,
): SanitizeReInviteSchemeResult {
  const causes = scheme?.reinviteCauses;
  if (!scheme || !Array.isArray(causes)) {
    return { changed: false, keptCauseCount: 0, dropped: [] };
  }

  const dropped: DroppedReInviteCause[] = [];
  const kept: ReInviteCauseLike[] = [];

  for (const cause of causes) {
    const event = isPlainRecord(cause) && typeof cause.event === "string" ? cause.event : null;
    if (!event || !ENDPOINT_RESOLVING_EVENTS.has(event)) {
      kept.push(cause);
      continue;
    }

    const id = typeof cause.id === "string" ? cause.id : "";
    if (id === "") {
      dropped.push({ event, id, reason: "invalid_cause_id" });
      continue;
    }

    const reason = classifyUnresolvableCause(scheme.endpoints, id);
    if (reason) {
      dropped.push({ event, id, reason });
      continue;
    }

    kept.push(cause);
  }

  if (dropped.length > 0) {
    scheme.reinviteCauses = kept;
  }

  return { changed: dropped.length > 0, keptCauseCount: kept.length, dropped };
}

// ─── WebSDK connection wiring ────────────────────────────────────────────────

type ReInviteMessageLike = {
  payload?: {
    params?: {
      id?: unknown;
      scheme?: ReInviteSchemeLike | null;
    } | null;
  } | null;
};

type SubscribeMessage = (
  messageName: "handleReInvite",
  subscriber: (message: never) => void | Promise<void>,
) => void;

export type VoxConnectionSeam = {
  subscribeMessage: SubscribeMessage;
  unsubscribeMessage: SubscribeMessage;
};

export type InstallVoxReInviteSchemeSanitizerResult = {
  /** False when the seam was unavailable or a sanitizer was already installed. */
  installed: boolean;
  reason?: "no_connection" | "already_installed";
  uninstall: () => void;
};

/**
 * Marker kept on the Connection instance so Fast Refresh (which re-evaluates
 * this module and loses module-level state) cannot install a second sanitizer.
 */
const INSTALLED_MARKER = "__negotiationsVoxReInviteSanitizer";

const noopUninstall = () => {};

export function installVoxReInviteSchemeSanitizer(input: {
  connection: VoxConnectionSeam | null | undefined;
  /** Invoked only when causes were actually dropped from a ReInvite. */
  onDropped?: (dropped: DroppedReInviteCause[], conferenceCallId: string | null) => void;
}): InstallVoxReInviteSchemeSanitizerResult {
  const { connection, onDropped } = input;
  if (!connection || typeof connection.subscribeMessage !== "function") {
    return { installed: false, reason: "no_connection", uninstall: noopUninstall };
  }

  const host = connection as VoxConnectionSeam & { [INSTALLED_MARKER]?: boolean };
  if (host[INSTALLED_MARKER]) {
    return { installed: false, reason: "already_installed", uninstall: noopUninstall };
  }

  const subscriber = (message: ReInviteMessageLike) => {
    const params = message?.payload?.params;
    const result = sanitizeReInviteScheme(params?.scheme);
    if (!result.changed) return;
    const callId = typeof params?.id === "string" ? params.id : null;
    onDropped?.(result.dropped, callId);
  };

  connection.subscribeMessage("handleReInvite", subscriber as (message: never) => void);
  Object.defineProperty(host, INSTALLED_MARKER, {
    value: true,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return {
    installed: true,
    uninstall: () => {
      if (typeof connection.unsubscribeMessage === "function") {
        connection.unsubscribeMessage("handleReInvite", subscriber as (message: never) => void);
      }
      host[INSTALLED_MARKER] = false;
    },
  };
}

/**
 * Single-shot console reporter for dropped causes. Deduplicates by
 * `event:reason` so a long call cannot flood the console.
 */
export function createDroppedCauseReporter(
  emit: (message: string) => void = (message) => console.warn(message),
) {
  const seen = new Set<string>();
  return (dropped: DroppedReInviteCause[], conferenceCallId: string | null) => {
    for (const cause of dropped) {
      const key = `${cause.event}:${cause.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      emit(
        `[Voximplant] dropped unresolvable ReInvite cause ${cause.event} for endpoint ` +
          `${cause.id} (${cause.reason}) on call ${conferenceCallId ?? "unknown"}. ` +
          "Provider announced an endpoint with no scheme.endpoints entry; " +
          "see docs/architecture/05-voximplant-integration.md.",
      );
    }
  };
}
