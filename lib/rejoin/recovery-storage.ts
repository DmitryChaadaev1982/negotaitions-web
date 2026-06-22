export const RECOVERY_STORAGE_KEY = "negotaitions.recovery.v1";

export const DEFAULT_RECOVERY_TTL_MS = 12 * 60 * 60 * 1000;

export type RecoveryContextType =
  | "EVENT_LOBBY"
  | "SESSION_ROOM"
  | "SESSION_JOIN";

export type RecoveryContext = {
  type: RecoveryContextType;
  eventId?: string;
  sessionId?: string;
  hostToken?: string;
  participantToken?: string;
  joinToken?: string;
  displayName?: string;
  updatedAt: string;
};

export type SaveRecoveryContextInput = Omit<RecoveryContext, "updatedAt"> & {
  updatedAt?: string;
};

function isBrowser() {
  return typeof window !== "undefined";
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

    const parsed = JSON.parse(raw) as RecoveryContext;

    if (!parsed?.type || !parsed.updatedAt) {
      return null;
    }

    return parsed;
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
  const next: RecoveryContext = {
    ...current,
    ...input,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };

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

export function getEventParticipantTokenForEvent(eventId: string) {
  const context = getValidRecoveryContext();

  if (!context || context.eventId !== eventId) {
    return null;
  }

  return context.participantToken ?? null;
}
