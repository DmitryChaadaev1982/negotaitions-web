/**
 * Stage 5.4.8 — Temporary Voximplant recording diagnostics event bus.
 *
 * In-memory ring buffer stored on globalThis so it survives HMR in the
 * Next.js dev server but is intentionally lost on a full server restart
 * (safe for dev only — never persisted to DB).
 *
 * Production guard: all exports are no-ops when
 *   RECORDING_DEBUG_PANEL !== "true"  AND
 *   NODE_ENV === "production"
 *
 * Do NOT import this file into production-critical code paths without
 * wrapping the call in an isRecordingDebugEnabled() check, or rely on
 * the fact that all functions silently no-op when disabled.
 */

import { randomUUID } from "crypto";

// ─── Type definitions ─────────────────────────────────────────────────────────

export type RecordingDebugEventSource =
  | "client"
  | "recording-control"
  | "control"
  | "webhook"
  | "refresh-recording"
  | "materials-status"
  | "db"
  | "scenario-message"
  | "smoke-test";

export type RecordingDebugEventLevel = "info" | "warn" | "error" | "success";

export type RecordingDebugEvent = {
  id: string;
  ts: string;
  sessionId: string;
  source: RecordingDebugEventSource;
  level: RecordingDebugEventLevel;
  step: string;
  message: string;
  data?: Record<string, unknown>;
};

// ─── Global ring buffer ───────────────────────────────────────────────────────

const RING_BUFFER_MAX = 200;

type DebugStore = {
  events: Map<string, RecordingDebugEvent[]>;
};

declare global {
  var __recordingDebugStore: DebugStore | undefined; // required for globalThis augmentation
}

function getStore(): DebugStore {
  if (!globalThis.__recordingDebugStore) {
    globalThis.__recordingDebugStore = { events: new Map() };
  }
  return globalThis.__recordingDebugStore;
}

// ─── Feature gate ─────────────────────────────────────────────────────────────

export function isRecordingDebugEnabled(): boolean {
  if (process.env.RECORDING_DEBUG_PANEL === "true") return true;
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_RECORDING_DEBUG_PANEL === "true"
  ) {
    return true;
  }
  return false;
}

// ─── Redaction ────────────────────────────────────────────────────────────────

/**
 * Sensitive key patterns (lowercase match). Values under these keys are
 * replaced with "[REDACTED]" unless the value is a safe boolean/scalar.
 */
const SENSITIVE_KEY_PATTERNS = [
  "secret",
  "signature",
  "hmac",
  "cookie",
  "token",
  "authorization",
  "auth",
  "password",
];

/**
 * Safe keys that look sensitive but carry non-secret boolean/ID values.
 * These are passed through even if they contain a sensitive-looking keyword.
 */
const SAFE_KEYS = new Set([
  "signaturePresent",
  "signatureValid",
  "webhookSecretConfigured",
  "sessionId",
  "recordingId",
  "participantId",
  "requestId",
  "status",
  "provider",
  "action",
  "webhookBaseUrl",
  "conferenceName",
  "fileKeyPresent",
  "normalizedFileKeyPresent",
  "authMode",
]);

function isSensitiveKey(key: string): boolean {
  if (SAFE_KEYS.has(key)) return false;
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Recursively redacts sensitive values from a data object.
 * Booleans and numbers are never redacted.
 * Safe keys are never redacted.
 */
export function redactDebugData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (isSensitiveKey(k)) {
      // Keep booleans/numbers as they are informative without exposing secrets.
      if (typeof v === "boolean" || typeof v === "number") {
        out[k] = v;
      } else {
        out[k] = "[REDACTED]";
      }
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactDebugData(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Append a debug event to the ring buffer for the given session.
 * No-op when diagnostics are disabled.
 */
export function appendRecordingDebugEvent(
  event: Omit<RecordingDebugEvent, "id" | "ts">,
): void {
  if (!isRecordingDebugEnabled()) return;

  const store = getStore();
  const sessionEvents = store.events.get(event.sessionId) ?? [];

  const full: RecordingDebugEvent = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    ...event,
    data: event.data ? redactDebugData(event.data) : undefined,
  };

  sessionEvents.push(full);

  // Trim to ring buffer size.
  if (sessionEvents.length > RING_BUFFER_MAX) {
    sessionEvents.splice(0, sessionEvents.length - RING_BUFFER_MAX);
  }

  store.events.set(event.sessionId, sessionEvents);
}

/**
 * Return all debug events for a session (newest last).
 * Returns empty array when disabled or session has no events.
 */
export function getRecordingDebugEvents(sessionId: string): RecordingDebugEvent[] {
  if (!isRecordingDebugEnabled()) return [];
  return getStore().events.get(sessionId) ?? [];
}

/**
 * Clear all debug events for a session.
 */
export function clearRecordingDebugEvents(sessionId: string): void {
  getStore().events.delete(sessionId);
}
