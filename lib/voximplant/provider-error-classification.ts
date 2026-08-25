/**
 * Classification of Voximplant WebSDK failures for the room/lobby media handoff.
 *
 * The WebSDK reports transport, gateway and ICE-recovery problems through the
 * same `LogLevel.Error` channel that it uses for genuine faults. Forwarding all
 * of them to `console.error` makes the Next.js development overlay take over the
 * page for failures the application already recovers from.
 *
 * Classification is driven by the SDK error type, transport status code, failed
 * action name and socket-close evidence — never by a broad substring such as
 * "timeout" or "closed with error" — combined with the current lifecycle phase,
 * because the same transport error means something different while a session is
 * intentionally tearing down than it does on a steady-state connection.
 */

export type VoxProviderErrorClass =
  | "RECOVERABLE_TRANSIENT"
  | "EXPECTED_DURING_INTENTIONAL_TEARDOWN"
  | "TERMINAL_PROVIDER_FAILURE"
  | "APPLICATION_INVARIANT_FAILURE";

/**
 * Where the owning surface is in its own media lifecycle. `handoff` means a
 * Session room is being left and the Event lobby is taking over the shared
 * WebSDK client.
 */
export type VoxLifecyclePhase =
  | "idle"
  | "connecting"
  | "connected"
  | "intentional_teardown"
  | "handoff";

/**
 * What the SDK actually tells us about a closed WebSocket.
 *
 * The observed gateway line is
 * `[WEBSDK] [GW Transport] WS transport <id> closed with error {"isTrusted":true}`.
 * The trailing object is a serialized DOM event, and `code`, `reason` and
 * `wasClean` are prototype accessors on `CloseEvent`, so `JSON.stringify` drops
 * them and only `isTrusted` survives. Every field below is therefore optional:
 * the closure itself and its scope are the reliable evidence, and a close code
 * is used when the SDK happens to log one.
 */
export type VoxTransportClosure = {
  /** WebSocket close code when the SDK logged one, e.g. `1006`. */
  closeCode: number | null;
  closeReason: string | null;
  wasClean: boolean | null;
  /** `true` for a real browser event, `false` for one the SDK synthesised. */
  isTrusted: boolean | null;
};

export type VoxProviderSignal = {
  /** Raw message the classification was derived from. */
  message: string;
  /** SDK logger scope, e.g. `Connection` or `ReInviteQueue_conference_x`. */
  scope: string | null;
  /** SDK error constructor name, e.g. `TransportTimeoutError`. */
  errorType: string | null;
  /** Transport/gateway status code, e.g. 408. */
  transportCode: number | null;
  /** Failed SDK action name, e.g. `IceRestartAction`. */
  actionName: string | null;
  /** Present only when the SDK reported a transport socket closing. */
  transportClosure: VoxTransportClosure | null;
  /** True when the message came from the WebSDK rather than application code. */
  fromWebSdk: boolean;
};

export type VoxClassificationContext = {
  phase: VoxLifecyclePhase;
  /** True while an intentional Session -> lobby provider handoff is in flight. */
  intentionalHandoff?: boolean;
  /** Connect attempts already spent for the current surface. */
  attempt?: number;
  /** Maximum connect attempts allowed for the current surface. */
  maxAttempts?: number;
};

export type VoxClassification = {
  class: VoxProviderErrorClass;
  /** Stable machine-readable reason used for structured logs and tests. */
  reason: string;
  /** True when the caller should schedule another bounded connect attempt. */
  retryable: boolean;
  /** True when nothing in the known taxonomy matched. Never silently dropped. */
  unknown: boolean;
  signal: VoxProviderSignal;
};

/**
 * Transport/gateway error types the SDK raises for conditions that resolve on a
 * later attempt: the socket never opened, or the gateway refused in time.
 */
const TRANSIENT_CONNECTION_ERROR_TYPES = new Set([
  "TransportTimeoutError",
  "TransportError",
  "ConnectionNetworkError",
  "ConnectionTimeoutError",
  "ConferenceSignallingTransportConnectionError",
  "SignallingTransportError",
  "WebSocketError",
]);

/** Error types that will not succeed on retry with the same credentials. */
const TERMINAL_AUTH_ERROR_TYPES = new Set([
  "AuthError",
  "AuthenticationError",
  "LoginError",
  "InvalidCredentialsError",
]);

/**
 * SDK actions that renegotiate an existing peer connection. Their failure means
 * media recovery did not complete; it never means the application is broken.
 */
const MEDIA_RECOVERY_ACTIONS = new Set([
  "IceRestartAction",
  "ReInviteAction",
  "RenegotiationAction",
  "UpdateAction",
]);

/**
 * Local getUserMedia / StreamManager failures. They do not mean the conference
 * is dead and must never start a provider rejoin.
 */
const LOCAL_MEDIA_DEVICE_ERROR_TYPES = new Set([
  "NotReadableError",
  "NotAllowedError",
  "NotFoundError",
  "OverconstrainedError",
  "AbortError",
]);

const REINVITE_TIMEOUT_ERROR_TYPES = new Set(["ReInviteFailedDueTimeout"]);

const TRANSIENT_TRANSPORT_CODES = new Set([408, 500, 502, 503, 504]);
const TERMINAL_TRANSPORT_CODES = new Set([401, 403]);

/**
 * WebSocket close codes the gateway uses to refuse the credentials rather than
 * to report a dropped link. They must stay terminal: retrying with the same
 * token only repeats the rejection.
 */
const TERMINAL_WEBSOCKET_CLOSE_CODES = new Set([1008, 4401, 4403]);

/**
 * Only a socket close reported under a transport scope is transport evidence.
 * The same words logged by, say, a conference or application scope describe
 * something else and must keep falling through to the unknown branch.
 */
function isTransportScope(scope: string | null): boolean {
  if (!scope) return false;
  const normalized = scope.toLowerCase();
  return normalized.includes("transport") || normalized === "connection";
}

/**
 * Matches the SDK's socket-close wording (`WS transport <id> closed with ...`)
 * and nothing else. Deliberately narrow: `closed with error` on its own is not
 * enough to call a failure recoverable.
 */
const WEBSOCKET_CLOSE_PATTERN = /\b(?:ws|websocket)\s+transport\b[^\n]*?\bclosed\b/i;

function parseTransportClosure(message: string): VoxTransportClosure | null {
  if (!WEBSOCKET_CLOSE_PATTERN.test(message)) return null;

  // Close codes are four digits (1000-4999) and never collide with the
  // three-digit gateway status codes parsed into `transportCode`.
  const closeCodeMatch = /"?(?:close)?code"?\s*[:=]\s*"?(\d{4})\b/i.exec(message);
  const reasonMatch = /"?(?:close)?reason"?\s*[:=]\s*"([^"]*)"/i.exec(message);
  const wasCleanMatch = /"?wasClean"?\s*[:=]\s*(true|false)\b/i.exec(message);
  const isTrustedMatch = /"?isTrusted"?\s*[:=]\s*(true|false)\b/i.exec(message);

  return {
    closeCode: closeCodeMatch ? Number.parseInt(closeCodeMatch[1]!, 10) : null,
    closeReason: reasonMatch?.[1] ?? null,
    wasClean: wasCleanMatch ? wasCleanMatch[1]!.toLowerCase() === "true" : null,
    isTrusted: isTrustedMatch ? isTrustedMatch[1]!.toLowerCase() === "true" : null,
  };
}

/**
 * Failure of our own provider-access endpoint. It is an authorization or
 * availability problem with media access, not an application invariant, so it
 * must not be reported as a fatal application diagnostic.
 */
export class VoxAccessError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "VoxAccessError";
    this.status = status;
  }
}

function toMessage(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Error) {
    return input.name && !input.message.startsWith(input.name)
      ? `${input.name}: ${input.message}`
      : input.message;
  }
  if (input && typeof input === "object" && "fullMessage" in input) {
    const value = (input as { fullMessage?: unknown }).fullMessage;
    if (typeof value === "string") return value;
  }
  return String(input);
}

export function parseVoxProviderSignal(
  input: unknown,
  extra?: { scope?: string | null },
): VoxProviderSignal {
  const message = toMessage(input);
  const extraScope =
    extra?.scope ??
    (input &&
    typeof input === "object" &&
    "extraData" in input &&
    (input as { extraData?: { scope?: unknown } }).extraData &&
    typeof (input as { extraData?: { scope?: unknown } }).extraData?.scope ===
      "string"
      ? (input as { extraData: { scope: string } }).extraData.scope
      : null);

  const scopeMatch = /\[WEBSDK\]\s*\[([^\]]+)\]/i.exec(message);
  const scope = extraScope ?? scopeMatch?.[1] ?? null;
  const fromWebSdk = /\[WEBSDK\]/i.test(message) || scopeMatch != null;

  // `TransportTimeoutError`, `ConnectionNetworkError`, ... — the SDK always
  // prints the constructor name before the human-readable detail.
  const errorTypeMatch =
    /\b([A-Z][A-Za-z0-9]*(?:Error|Exception))\b/.exec(message) ??
    /\b(ReInviteFailedDueTimeout)\b/.exec(message);
  const errorType =
    errorTypeMatch?.[1] ??
    (input instanceof Error &&
    /(?:Error|Exception|ReInviteFailedDueTimeout)$/.test(input.name)
      ? input.name
      : null);

  const codeMatch = /\b(?:code|status)\s*[:=]?\s*(\d{3})\b/i.exec(message);
  const transportCode = codeMatch ? Number.parseInt(codeMatch[1]!, 10) : null;

  const actionName = extractActionName(message);

  return {
    message,
    scope,
    errorType,
    transportCode,
    actionName,
    transportClosure: parseTransportClosure(message),
    fromWebSdk,
  };
}

/**
 * Production WebSDK embeds `actionName` inside JSON (sometimes escaped).
 * The older `actionName: "IceRestartAction"` prose form is still accepted.
 */
function extractActionName(message: string): string | null {
  const jsonAction =
    /(?:\\?")actionName(?:\\?")\s*:\s*(?:\\?")([A-Za-z0-9_]+)(?:\\?")/.exec(message);
  if (jsonAction?.[1]) return jsonAction[1];
  const proseAction = /actionName\s*[:=]\s*"?([A-Za-z0-9_]+)"?/.exec(message);
  return proseAction?.[1] ?? null;
}

function isReInviteTimeoutMessage(signal: VoxProviderSignal): boolean {
  if (signal.errorType && REINVITE_TIMEOUT_ERROR_TYPES.has(signal.errorType)) {
    return true;
  }
  const lower = signal.message.toLowerCase();
  const isTimeout =
    lower.includes("action run failed to timeout") ||
    lower.includes("reinvitefaileddutimeout");
  if (!isTimeout) return false;
  const scope = signal.scope?.toLowerCase() ?? "";
  return (
    scope.includes("reinvite") ||
    lower.includes("reinvitequeue") ||
    lower.includes("icerestartaction") ||
    Boolean(signal.actionName && MEDIA_RECOVERY_ACTIONS.has(signal.actionName))
  );
}

function isLocalMediaDeviceSignal(signal: VoxProviderSignal): boolean {
  if (signal.errorType && LOCAL_MEDIA_DEVICE_ERROR_TYPES.has(signal.errorType)) {
    return true;
  }
  const lower = signal.message.toLowerCase();
  return (
    lower.includes("notreadableerror") ||
    (lower.includes("device in use") &&
      (lower.includes("streammanager") || lower.includes("[websdk]")))
  );
}

function isTeardownContext(context: VoxClassificationContext): boolean {
  return (
    context.intentionalHandoff === true ||
    context.phase === "intentional_teardown" ||
    context.phase === "handoff"
  );
}

function hasRetryBudget(context: VoxClassificationContext): boolean {
  const { attempt, maxAttempts } = context;
  if (attempt == null || maxAttempts == null) return true;
  return attempt < maxAttempts;
}

/**
 * Classify a WebSDK log line or a thrown provider error.
 *
 * Application errors that carry no WebSDK signature (for example our own
 * `sdkUsername mismatch` security check) are reported as invariant failures so
 * they keep their loud diagnostic, while provider transport noise is downgraded.
 */
export function classifyVoxProviderFailure(
  input: unknown,
  context: VoxClassificationContext,
): VoxClassification {
  const signal = parseVoxProviderSignal(input);
  const teardown = isTeardownContext(context);

  const build = (
    errorClass: VoxProviderErrorClass,
    reason: string,
    options?: { retryable?: boolean; unknown?: boolean },
  ): VoxClassification => ({
    class: errorClass,
    reason,
    retryable: options?.retryable ?? false,
    unknown: options?.unknown ?? false,
    signal,
  });

  if (input instanceof VoxAccessError) {
    if (input.status === 401 || input.status === 403 || input.status === 409) {
      return build("TERMINAL_PROVIDER_FAILURE", `provider_access_rejected:${input.status}`);
    }
    if (input.status >= 500 || input.status === 408 || input.status === 429) {
      return build("RECOVERABLE_TRANSIENT", `provider_access_unavailable:${input.status}`, {
        retryable: hasRetryBudget(context),
      });
    }
    return build("TERMINAL_PROVIDER_FAILURE", `provider_access_rejected:${input.status}`);
  }

  if (signal.errorType && TERMINAL_AUTH_ERROR_TYPES.has(signal.errorType)) {
    return build("TERMINAL_PROVIDER_FAILURE", "provider_authorization_rejected");
  }
  if (signal.transportCode != null && TERMINAL_TRANSPORT_CODES.has(signal.transportCode)) {
    return build("TERMINAL_PROVIDER_FAILURE", "provider_authorization_rejected");
  }

  // A gateway socket that closes under an established connection is a link
  // loss, not a fault: the SDK re-establishes it, and the session keeps its
  // membership, media policy and lifecycle. It reaches here only with real
  // transport evidence — a transport scope plus the SDK's own close wording —
  // so a `GW Transport` message that is not a socket close, or a socket close
  // logged from an unrelated scope, still falls through to the unknown branch.
  // Terminal authorization evidence is matched above and wins.
  if (signal.transportClosure && isTransportScope(signal.scope)) {
    const { closeCode } = signal.transportClosure;
    if (closeCode != null && TERMINAL_WEBSOCKET_CLOSE_CODES.has(closeCode)) {
      return build("TERMINAL_PROVIDER_FAILURE", "provider_authorization_rejected");
    }
    if (teardown) {
      return build(
        "EXPECTED_DURING_INTENTIONAL_TEARDOWN",
        "gateway_websocket_closed_during_teardown",
      );
    }
    if (hasRetryBudget(context)) {
      return build("RECOVERABLE_TRANSIENT", "gateway_websocket_closed", {
        retryable: true,
      });
    }
    return build("TERMINAL_PROVIDER_FAILURE", "transport_retry_budget_exhausted");
  }

  if (isLocalMediaDeviceSignal(signal)) {
    if (teardown) {
      return build(
        "EXPECTED_DURING_INTENTIONAL_TEARDOWN",
        `local_media_device_abandoned_during_teardown:${signal.errorType ?? "device"}`,
      );
    }
    return build(
      "RECOVERABLE_TRANSIENT",
      `local_media_device_failure:${signal.errorType ?? "device"}`,
    );
  }

  // Media renegotiation failures. During an intentional teardown the peer
  // connection is being discarded anyway, so a failed ICE restart is expected.
  // A timeout here is signalling/media degradation, not proof the call hung up.
  const mediaAction =
    signal.actionName && MEDIA_RECOVERY_ACTIONS.has(signal.actionName)
      ? signal.actionName
      : isReInviteTimeoutMessage(signal)
        ? (signal.actionName ?? "ReInviteTimeout")
        : null;
  if (mediaAction) {
    if (teardown) {
      return build(
        "EXPECTED_DURING_INTENTIONAL_TEARDOWN",
        `media_recovery_abandoned_during_teardown:${mediaAction}`,
      );
    }
    return build("RECOVERABLE_TRANSIENT", `media_recovery_failed:${mediaAction}`, {
      retryable: hasRetryBudget(context),
    });
  }

  const isTransientConnection =
    (signal.errorType != null && TRANSIENT_CONNECTION_ERROR_TYPES.has(signal.errorType)) ||
    (signal.transportCode != null && TRANSIENT_TRANSPORT_CODES.has(signal.transportCode));

  if (isTransientConnection) {
    if (teardown) {
      return build(
        "EXPECTED_DURING_INTENTIONAL_TEARDOWN",
        signal.transportCode != null
          ? `transport_abandoned_during_teardown:${signal.transportCode}`
          : "transport_abandoned_during_teardown",
      );
    }
    if (hasRetryBudget(context)) {
      return build(
        "RECOVERABLE_TRANSIENT",
        signal.transportCode != null
          ? `transport_unavailable:${signal.transportCode}`
          : `transport_unavailable:${signal.errorType ?? "unknown"}`,
        { retryable: true },
      );
    }
    return build("TERMINAL_PROVIDER_FAILURE", "transport_retry_budget_exhausted");
  }

  // Not a recognised provider failure. Application-origin errors keep their
  // fatal diagnostic; unrecognised SDK errors stay visible as terminal.
  if (!signal.fromWebSdk) {
    return build("APPLICATION_INVARIANT_FAILURE", "application_invariant_failure", {
      unknown: true,
    });
  }
  return build("TERMINAL_PROVIDER_FAILURE", "unclassified_provider_failure", {
    unknown: true,
  });
}

export type VoxStructuredLogLevel = "debug" | "warn" | "error";

/**
 * Console level each classification is allowed to reach.
 *
 * `console.error` is reserved for failures the application cannot present as a
 * controlled state: our own invariants, and anything the taxonomy does not
 * recognise. A known provider outage already renders a lobby error panel with a
 * retry control, so escalating it to `console.error` would only replace a usable
 * page with the Next.js development overlay.
 */
export function logLevelForClassification(
  classification: VoxClassification,
): VoxStructuredLogLevel {
  if (classification.class === "APPLICATION_INVARIANT_FAILURE") return "error";
  if (classification.unknown) return "error";
  if (classification.class === "EXPECTED_DURING_INTENTIONAL_TEARDOWN") return "debug";
  return "warn";
}

/** Single-line structured diagnostic shared by every provider surface. */
export function formatVoxProviderLog(
  surface: string,
  classification: VoxClassification,
  context: VoxClassificationContext,
): string {
  const { signal } = classification;
  const fields: string[] = [
    `surface=${surface}`,
    `class=${classification.class}`,
    `reason=${classification.reason}`,
    `phase=${context.phase}`,
  ];
  if (context.intentionalHandoff) fields.push("handoff=true");
  if (signal.scope) fields.push(`scope=${signal.scope}`);
  if (signal.errorType) fields.push(`errorType=${signal.errorType}`);
  if (signal.transportCode != null) fields.push(`code=${signal.transportCode}`);
  if (signal.actionName) fields.push(`action=${signal.actionName}`);
  if (signal.transportClosure) {
    const { closeCode, wasClean } = signal.transportClosure;
    fields.push(`closeCode=${closeCode ?? "unknown"}`);
    if (wasClean != null) fields.push(`wasClean=${wasClean}`);
  }
  if (context.attempt != null && context.maxAttempts != null) {
    fields.push(`attempt=${context.attempt}/${context.maxAttempts}`);
  }
  return `[vox-provider] ${fields.join(" ")} :: ${signal.message}`;
}
