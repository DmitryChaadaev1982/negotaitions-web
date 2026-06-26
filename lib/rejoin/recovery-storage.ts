export const RECOVERY_STORAGE_KEY = "negotaitions.recovery.v1";

export const DEFAULT_RECOVERY_TTL_MS = 12 * 60 * 60 * 1000;

export type RecoveryContextType =
  | "EVENT_LOBBY"
  | "SESSION_ROOM"
  | "SESSION_JOIN";

/**
 * Phase 6.4.2: localStorage recovery stores ONLY non-secret UI hints.
 *
 * Guest runtime access is fully closed (Phase 6.4.1). Logged-in rejoin is
 * resolved server-side from the user/session relation (see lib/rejoin/account.ts
 * and app/rejoin/page.tsx), so no secret token ever needs to live in the browser.
 *
 * The following secrets MUST NEVER be persisted here:
 *   - joinToken
 *   - hostToken
 *   - participantToken
 *   - facilitatorJoinToken
 *
 * Legacy entries that still contain any of those fields are treated as invalid,
 * ignored, and cleared on read.
 */
export type RecoveryContext = {
  type: RecoveryContextType;
  eventId?: string;
  sessionId?: string;
  updatedAt: string;
};

export type SaveRecoveryContextInput = Omit<RecoveryContext, "updatedAt"> & {
  updatedAt?: string;
};

/**
 * Secret fields that must never be stored in browser recovery storage. Used to
 * detect and purge legacy entries written before Phase 6.4.2.
 */
export const RECOVERY_SECRET_FIELDS = [
  "joinToken",
  "hostToken",
  "participantToken",
  "facilitatorJoinToken",
] as const;

const RECOVERY_CONTEXT_TYPES: RecoveryContextType[] = [
  "EVENT_LOBBY",
  "SESSION_ROOM",
  "SESSION_JOIN",
];

function isBrowser() {
  return typeof window !== "undefined";
}

/**
 * Returns true if a parsed recovery value contains any legacy secret token.
 * Pure (no browser APIs) so it is unit-testable.
 */
export function recoveryValueHasLegacyToken(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  return RECOVERY_SECRET_FIELDS.some(
    (field) => typeof record[field] === "string" && record[field] !== "",
  );
}

/**
 * Strip any unknown/secret fields and return only the safe, non-secret hint
 * shape. Returns null for structurally invalid values. Pure (no browser APIs).
 */
export function sanitizeRecoveryContext(value: unknown): RecoveryContext | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.type !== "string" ||
    !RECOVERY_CONTEXT_TYPES.includes(record.type as RecoveryContextType) ||
    typeof record.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    type: record.type as RecoveryContextType,
    eventId: typeof record.eventId === "string" ? record.eventId : undefined,
    sessionId:
      typeof record.sessionId === "string" ? record.sessionId : undefined,
    updatedAt: record.updatedAt,
  };
}

export function getRecoveryTtlMs() {
  const raw = process.env.NEXT_PUBLIC_RECOVERY_TTL_HOURS;

  if (!raw) {
    return DEFAULT_RECOVERY_TTL_MS;
  }

  const hours = Number(raw);

  if (!Number.isFinite(hours) || hours <= 0) {
    return DEFAULT_RECOVERY_TTL_MS;
  }

  return hours * 60 * 60 * 1000;
}

function notifyRecoveryStorageChanged() {
  if (!isBrowser()) {
    return;
  }

  window.dispatchEvent(new Event("negotaitions:recovery-updated"));
}

export function readRecoveryContext(): RecoveryContext | null {
  if (!isBrowser()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(RECOVERY_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;

    // Legacy entry containing a secret token: ignore it and clear it so no
    // guest secret can ever be reused for runtime auth.
    if (recoveryValueHasLegacyToken(parsed)) {
      window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
      return null;
    }

    return sanitizeRecoveryContext(parsed);
  } catch {
    return null;
  }
}

export function isRecoveryContextExpired(
  context: RecoveryContext,
  now = Date.now(),
) {
  const updatedAt = Date.parse(context.updatedAt);

  if (Number.isNaN(updatedAt)) {
    return true;
  }

  return now - updatedAt > getRecoveryTtlMs();
}

export function getValidRecoveryContext(): RecoveryContext | null {
  const context = readRecoveryContext();

  if (!context || isRecoveryContextExpired(context)) {
    return null;
  }

  return context;
}

export function saveRecoveryContext(input: SaveRecoveryContextInput) {
  if (!isBrowser()) {
    return;
  }

  const current = readRecoveryContext();
  const merged = {
    ...current,
    ...input,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };

  // sanitize guarantees only the non-secret hint shape is ever written, even if
  // a caller accidentally passes extra/secret fields.
  const next = sanitizeRecoveryContext(merged);

  if (!next) {
    return;
  }

  window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(next));
  notifyRecoveryStorageChanged();
}

export function touchRecoveryContext() {
  const context = readRecoveryContext();

  if (!context) {
    return;
  }

  saveRecoveryContext(context);
}

export function clearRecoveryContext() {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
  notifyRecoveryStorageChanged();
}
