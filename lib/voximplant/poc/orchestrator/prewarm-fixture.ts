/**
 * Local-only prewarm fixture for replaying browser auth without recreating Sessions.
 * Stored under .agent/ (gitignored). Never print cookie/token values.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getPocRunPaths } from "@/lib/voximplant/poc/poc-run-store";
import {
  POC_FACILITATOR_PASSWORD,
  namespaceForRunId,
} from "@/lib/voximplant/poc/create-poc-session";

export type PocPrewarmFixture = {
  runId: string;
  sessionId: string;
  facilitatorUserId: string;
  facilitatorEmail: string;
  /** Constant POC password; not a unique secret per run. */
  facilitatorPassword: string;
  /** Full Set-Cookie style header: auth_session=<rawToken> */
  facilitatorAuthCookie: string;
  participantUserId?: string;
  participantEmail?: string;
  participantPassword?: string;
  /** Participant's own auth_session — never the facilitator cookie. */
  participantAuthCookie?: string;
  facilitatorJoinToken: string;
  participantJoinToken: string;
  facilitatorRoomUrl: string;
  participantRoomUrl: string;
  participantAccountRoomUrl?: string;
  createdAt: string;
};

export function getPrewarmFixturePath(
  runId: string,
  stateRoot?: string,
): string {
  const paths = getPocRunPaths(runId, stateRoot);
  return join(paths.runDir, "local", "prewarm-auth.json");
}

export function writePrewarmFixture(
  fixture: PocPrewarmFixture,
  stateRoot?: string,
): string {
  const path = getPrewarmFixturePath(fixture.runId, stateRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, {
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
    if (
      !parsed?.sessionId ||
      !parsed?.facilitatorAuthCookie ||
      !parsed?.facilitatorUserId
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildFacilitatorEmailForRun(runId: string): string {
  return `${namespaceForRunId(runId)}.facilitator@test.negotaitions.local`;
}

export function defaultFacilitatorPassword(): string {
  return POC_FACILITATOR_PASSWORD;
}
