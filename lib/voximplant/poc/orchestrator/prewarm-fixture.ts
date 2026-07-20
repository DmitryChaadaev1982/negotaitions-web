/**
 * Local-only prewarm fixture metadata (gitignored under .agent/).
 * Never persist plaintext passwords, auth cookies, join tokens, or tokenized URLs.
 * Secrets stay in process memory only.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getPocRunPaths } from "@/lib/voximplant/poc/poc-run-store";
import { namespaceForRunId } from "@/lib/voximplant/poc/create-poc-session";

function fingerprintSecret(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string" || !value.trim()) return null;
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

export type PocPrewarmFixture = {
  runId: string;
  sessionId: string;
  authStrategy: "CANONICAL_COOKIE" | "UI_LOGIN" | "UNKNOWN";
  facilitatorUserId: string;
  facilitatorEmail: string;
  facilitatorRole: "FACILITATOR";
  facilitatorAuthConfigured: boolean;
  facilitatorAuthCookieFingerprint: string | null;
  facilitatorJoinTokenFingerprint: string | null;
  facilitatorRoomUrlConfigured: boolean;
  participantUserId?: string;
  participantEmail?: string;
  participantRole?: "PARTICIPANT";
  participantAuthConfigured?: boolean;
  participantAuthCookieFingerprint?: string | null;
  participantJoinTokenFingerprint?: string | null;
  participantRoomUrlConfigured?: boolean;
  participantAccountRoomUrlConfigured?: boolean;
  createdAt: string;
  /**
   * @deprecated Secrets must not be persisted. Present only when reading legacy
   * fixtures; writers never store these fields.
   */
  facilitatorPassword?: string;
  /** @deprecated */
  facilitatorAuthCookie?: string;
  /** @deprecated */
  participantPassword?: string;
  /** @deprecated */
  participantAuthCookie?: string;
  /** @deprecated */
  facilitatorJoinToken?: string;
  /** @deprecated */
  participantJoinToken?: string;
  /** @deprecated */
  facilitatorRoomUrl?: string;
  /** @deprecated */
  participantRoomUrl?: string;
  /** @deprecated */
  participantAccountRoomUrl?: string;
};

/** In-memory secrets for the current process (never written to disk). */
export type PocPrewarmSecrets = {
  facilitatorPassword: string;
  facilitatorAuthCookie: string;
  participantPassword?: string;
  participantAuthCookie?: string;
  facilitatorJoinToken: string;
  participantJoinToken: string;
  facilitatorRoomUrl: string;
  participantRoomUrl: string;
  participantAccountRoomUrl?: string;
};

const secretsByRun = new Map<string, PocPrewarmSecrets>();

export function rememberPrewarmSecrets(
  runId: string,
  secrets: PocPrewarmSecrets,
): void {
  secretsByRun.set(runId, secrets);
}

export function recallPrewarmSecrets(runId: string): PocPrewarmSecrets | null {
  return secretsByRun.get(runId) ?? null;
}

export function clearPrewarmSecrets(runId: string): void {
  secretsByRun.delete(runId);
}

export function buildSanitizedPrewarmFixture(params: {
  runId: string;
  sessionId: string;
  facilitatorUserId: string;
  facilitatorEmail: string;
  facilitatorAuthCookie?: string | null;
  facilitatorJoinToken?: string | null;
  facilitatorRoomUrl?: string | null;
  participantUserId?: string;
  participantEmail?: string;
  participantAuthCookie?: string | null;
  participantJoinToken?: string | null;
  participantRoomUrl?: string | null;
  participantAccountRoomUrl?: string | null;
  authStrategy?: PocPrewarmFixture["authStrategy"];
  createdAt?: string;
}): PocPrewarmFixture {
  return {
    runId: params.runId,
    sessionId: params.sessionId,
    authStrategy: params.authStrategy ?? "CANONICAL_COOKIE",
    facilitatorUserId: params.facilitatorUserId,
    facilitatorEmail: params.facilitatorEmail,
    facilitatorRole: "FACILITATOR",
    facilitatorAuthConfigured: Boolean(params.facilitatorAuthCookie),
    facilitatorAuthCookieFingerprint: fingerprintSecret(
      params.facilitatorAuthCookie,
    ),
    facilitatorJoinTokenFingerprint: fingerprintSecret(
      params.facilitatorJoinToken,
    ),
    facilitatorRoomUrlConfigured: Boolean(params.facilitatorRoomUrl),
    participantUserId: params.participantUserId,
    participantEmail: params.participantEmail,
    participantRole: params.participantUserId ? "PARTICIPANT" : undefined,
    participantAuthConfigured: Boolean(params.participantAuthCookie),
    participantAuthCookieFingerprint: fingerprintSecret(
      params.participantAuthCookie,
    ),
    participantJoinTokenFingerprint: fingerprintSecret(
      params.participantJoinToken,
    ),
    participantRoomUrlConfigured: Boolean(params.participantRoomUrl),
    participantAccountRoomUrlConfigured: Boolean(
      params.participantAccountRoomUrl,
    ),
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

export function getPrewarmFixturePath(
  runId: string,
  stateRoot?: string,
): string {
  const paths = getPocRunPaths(runId, stateRoot);
  return join(paths.runDir, "local", "prewarm-auth.json");
}

export function writePrewarmFixture(
  fixture: PocPrewarmFixture | (Partial<PocPrewarmFixture> & {
    runId: string;
    sessionId: string;
    facilitatorUserId: string;
    facilitatorEmail: string;
    facilitatorPassword?: string;
    facilitatorAuthCookie?: string;
    facilitatorJoinToken?: string;
    facilitatorRoomUrl?: string;
    participantUserId?: string;
    participantEmail?: string;
    participantPassword?: string;
    participantAuthCookie?: string;
    participantJoinToken?: string;
    participantRoomUrl?: string;
    participantAccountRoomUrl?: string;
  }),
  stateRoot?: string,
): string {
  // Keep secrets in process memory when provided; never persist them.
  if (
    fixture.facilitatorAuthCookie ||
    fixture.facilitatorJoinToken ||
    fixture.facilitatorPassword
  ) {
    rememberPrewarmSecrets(fixture.runId, {
      facilitatorPassword: fixture.facilitatorPassword ?? "",
      facilitatorAuthCookie: fixture.facilitatorAuthCookie ?? "",
      participantPassword: fixture.participantPassword,
      participantAuthCookie: fixture.participantAuthCookie,
      facilitatorJoinToken: fixture.facilitatorJoinToken ?? "",
      participantJoinToken: fixture.participantJoinToken ?? "",
      facilitatorRoomUrl: fixture.facilitatorRoomUrl ?? "",
      participantRoomUrl: fixture.participantRoomUrl ?? "",
      participantAccountRoomUrl: fixture.participantAccountRoomUrl,
    });
  }

  const sanitized = buildSanitizedPrewarmFixture({
    runId: fixture.runId,
    sessionId: fixture.sessionId,
    facilitatorUserId: fixture.facilitatorUserId,
    facilitatorEmail: fixture.facilitatorEmail,
    facilitatorAuthCookie:
      fixture.facilitatorAuthCookie ??
      (fixture.facilitatorAuthConfigured ? "configured" : null),
    facilitatorJoinToken: fixture.facilitatorJoinToken,
    facilitatorRoomUrl: fixture.facilitatorRoomUrl,
    participantUserId: fixture.participantUserId,
    participantEmail: fixture.participantEmail,
    participantAuthCookie: fixture.participantAuthCookie,
    participantJoinToken: fixture.participantJoinToken,
    participantRoomUrl: fixture.participantRoomUrl,
    participantAccountRoomUrl: fixture.participantAccountRoomUrl,
    authStrategy: fixture.authStrategy,
    createdAt: fixture.createdAt,
  });

  // Force configured flags from fingerprints when building from sanitized input.
  if (fixture.facilitatorAuthConfigured != null) {
    sanitized.facilitatorAuthConfigured = fixture.facilitatorAuthConfigured;
  }
  if (fixture.facilitatorAuthCookieFingerprint) {
    sanitized.facilitatorAuthCookieFingerprint =
      fixture.facilitatorAuthCookieFingerprint;
  }

  const path = getPrewarmFixturePath(fixture.runId, stateRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sanitized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return path;
}

export function readPrewarmFixture(
  runId: string,
  stateRoot?: string,
): PocPrewarmFixture | null {
  const path = getPrewarmFixturePath(runId, stateRoot);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PocPrewarmFixture;
    if (!parsed?.sessionId || !parsed?.facilitatorUserId) {
      return null;
    }
    // Merge in-memory secrets when available (same process).
    const secrets = recallPrewarmSecrets(runId);
    if (secrets) {
      return {
        ...parsed,
        facilitatorPassword: secrets.facilitatorPassword,
        facilitatorAuthCookie: secrets.facilitatorAuthCookie,
        participantPassword: secrets.participantPassword,
        participantAuthCookie: secrets.participantAuthCookie,
        facilitatorJoinToken: secrets.facilitatorJoinToken,
        participantJoinToken: secrets.participantJoinToken,
        facilitatorRoomUrl: secrets.facilitatorRoomUrl,
        participantRoomUrl: secrets.participantRoomUrl,
        participantAccountRoomUrl: secrets.participantAccountRoomUrl,
      };
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildFacilitatorEmailForRun(runId: string): string {
  return `${namespaceForRunId(runId)}.facilitator@test.negotaitions.local`;
}

/** @deprecated Passwords are unique per run and never persisted. */
export function defaultFacilitatorPassword(): string {
  return "";
}

export function prewarmFixtureContainsPlaintextSecrets(
  fixture: PocPrewarmFixture,
): boolean {
  const suspicious = [
    fixture.facilitatorPassword,
    fixture.participantPassword,
    fixture.facilitatorAuthCookie,
    fixture.participantAuthCookie,
    fixture.facilitatorJoinToken,
    fixture.participantJoinToken,
    fixture.facilitatorRoomUrl,
    fixture.participantRoomUrl,
  ];
  return suspicious.some(
    (value) =>
      typeof value === "string" &&
      value.length > 0 &&
      !value.startsWith("sha256:"),
  );
}
