/**
 * Playwright browser prewarm + live join for full-mode POC.
 * Expects the Next.js app already running from this worktree (no second server).
 *
 * PREWARM (before StartConference): launch, permissions, auth, room shell —
 * access/WebSDK join held until LIVE phase.
 * LIVE (after StartConference): release both joins concurrently.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import { resolveRuntimeStatus } from "@/lib/voximplant/poc/poc-state";
import { readCurrentPointer } from "@/lib/voximplant/poc/poc-run-store";
import { readPocState } from "@/lib/voximplant/poc/poc-state";

import {
  buildAuthFailureDiagnostics,
  buildUrlBoundAuthCookie,
  parseCookieHeader,
  prepareParticipantJoinContext,
  redactBoundedErrorMessage,
} from "./browser-auth-cookie";
import {
  hasAuthSessionCookieHeader,
  installFacilitatorAuthViaUiLogin,
  isRawIdMistakenForAuthSession,
  verifyFacilitatorAuthInContext,
  type AuthNestedFailureCode,
  type AuthStrategy,
} from "./browser-auth-verify";
import {
  buildParticipantAuthCookieInstall,
  classifyParticipantAccessFailure,
  classifyParticipantNavigation,
  extractJoinTokenFromRoomUrl,
  verifyParticipantAuthInContext,
} from "./participant-prewarm";
import { persistBrowserContextArtifacts } from "./browser-artifacts";
import {
  advanceStage,
  classifyAccessHttpStatus,
  classifyBrowserFailure,
  emptyBrowserContextEvidence,
  markFailed,
  sanitizeConsoleMessage,
  sanitizePageUrl,
  type BrowserContextEvidence,
  type BrowserFailureCode,
  type BrowserStage,
} from "./browser-stages";

function nestedToBrowserFailure(
  nested: AuthNestedFailureCode | null,
): BrowserFailureCode {
  if (!nested) return "FACILITATOR_AUTH_FAILED";
  return nested;
}

export type BrowserJoinInput = {
  appBaseUrl: string;
  sessionId: string;
  expectedConferenceName: string;
  facilitatorRoomUrl: string;
  participantRoomUrl: string;
  facilitatorAuthCookie: string;
  participantAuthCookie?: string | null;
  timeoutMs: number;
  keepBrowser?: boolean;
  runId?: string;
  stateRoot?: string;
  expiresAt?: string | null;
  nowMs?: () => number;
};

export type BrowserJoinTiming = {
  browserPrewarmStartedAt: string | null;
  browserPrewarmCompletedAt: string | null;
  startConferenceStartedAt: string | null;
  startConferenceCompletedAt: string | null;
  activeRunPublishedAt: string | null;
  facilitatorAccessRequestedAt: string | null;
  participantAccessRequestedAt: string | null;
  facilitatorCallConnectedAt: string | null;
  participantCallConnectedAt: string | null;
  browserReleaseToFirstAccessMs: number | null;
  browserReleaseToFirstJoinMs: number | null;
  browserReleaseToBothJoinedMs: number | null;
  /**
   * @deprecated Use browserReleaseToFirstAccessMs.
   */
  startConferenceToFirstAccessMs: number | null;
  /**
   * @deprecated Use browserReleaseToFirstJoinMs.
   */
  startConferenceToFirstJoinMs: number | null;
  /**
   * @deprecated Use browserReleaseToBothJoinedMs.
   */
  startConferenceToBothJoinedMs: number | null;
};

export type BrowserRelayRecordingStartInput = {
  scenarioMessage: unknown;
  operationId?: string | null;
  expectedSessionId?: string | null;
  expectedConferenceName?: string | null;
};

export type BrowserRelayRecordingStartResult = {
  ok: boolean;
  recordingBrowserCommandClaimedAt: string | null;
  recordingBrowserCommandReceivedAt: string | null;
  recordingBrowserContextRole: string | null;
  recordingBrowserContextId: string | null;
  callReferenceFound: boolean;
  callReferenceSource:
    | "EXPLICIT_ACTIVE_CALL_REF"
    | "DOCUMENTED_CONFERENCE_API"
    | "LEGACY_HEURISTIC"
    | "NOT_FOUND";
  callConnected: boolean;
  callIdSanitized: string | null;
  callState: string | null;
  conferenceName: string | null;
  recordingBrowserCallReferenceFound: boolean;
  recordingBrowserCallReferenceSource:
    | "EXPLICIT_ACTIVE_CALL_REF"
    | "DOCUMENTED_CONFERENCE_API"
    | "LEGACY_HEURISTIC"
    | "NOT_FOUND";
  recordingBrowserCallConnected: boolean;
  recordingBrowserCallIdSanitized: string | null;
  recordingBrowserCallId: string | null;
  recordingBrowserCallState: string | null;
  recordingBrowserConferenceName: string | null;
  recordingBrowserSendMessageInvokedAt: string | null;
  recordingBrowserSendMessageCompletedAt: string | null;
  recordingBrowserSendMessageErrorCode: string | null;
  relayOwnerRole: string | null;
  relayOwnerParticipantId: string | null;
  relayOwnerConnectionId: string | null;
  relayClaimedAt: string | null;
  relayConsumedAt: string | null;
  recordingBrowserCommandSentAt: string | null;
  operationId: string | null;
  errorCode: string | null;
};

export type BrowserJoinResult = {
  facilitatorJoined: boolean;
  participantJoined: boolean;
  sameConferenceConfirmed: boolean;
  facilitatorConferenceName: string | null;
  participantConferenceName: string | null;
  browserRelayUsed: boolean;
  failureCode: BrowserFailureCode | null;
  facilitator: BrowserContextEvidence;
  participant: BrowserContextEvidence;
  timing: BrowserJoinTiming;
  evidence: Record<string, unknown>;
  /**
   * Live helper: start recording via facilitator UI (consent + start).
   * Relays scenarioMessage through the real browser adapter / WebSDK.
   */
  startRecordingViaUi?: (timeoutMs: number) => Promise<{
    started: boolean;
    evidence: Record<string, unknown>;
  }>;
  /**
   * Live helper: relay a pre-built scenario message via conference.sendMessage.
   * Returns staged browser evidence for deterministic relay ownership.
   */
  relayScenarioMessage?: (
    input: BrowserRelayRecordingStartInput,
  ) => Promise<BrowserRelayRecordingStartResult>;
  close: () => Promise<void>;
};

export type BrowserPrewarmInput = {
  appBaseUrl: string;
  sessionId: string;
  facilitatorRoomUrl: string;
  participantRoomUrl: string;
  /** Canonical auth_session=<rawToken> cookie header when available. */
  facilitatorAuthCookie?: string | null;
  facilitatorUserId: string;
  facilitatorEmail?: string;
  facilitatorPassword?: string;
  /**
   * Prefer CANONICAL_COOKIE when facilitatorAuthCookie is set.
   * UI_LOGIN is recovery for prewarm-only runs without a stored cookie.
   */
  facilitatorAuthStrategy?: AuthStrategy;
  /** Participant's own auth_session — never the facilitator cookie. */
  participantAuthCookie?: string | null;
  participantUserId?: string;
  participantEmail?: string;
  timeoutMs: number;
  keepBrowser?: boolean;
  runId: string;
  stateRoot?: string;
  nowMs?: () => number;
  /** When false, verification reports AUTH_SESSION_NOT_FOUND. */
  sessionExists?: boolean;
  /** Prewarm-only: stop before room navigation / access. */
  prewarmOnly?: boolean;
};

export type BrowserPrewarmHandle = {
  ok: boolean;
  failureCode: BrowserFailureCode | null;
  browserPrewarmStartedAt: string;
  browserPrewarmCompletedAt: string | null;
  facilitator: BrowserContextEvidence;
  participant: BrowserContextEvidence;
  evidence: Record<string, unknown>;
  /** Present after successful auth; never logged by callers. */
  facilitatorAuthCookieHeader?: string | null;
  liveJoin: (params: {
    expectedConferenceName: string;
    expiresAt: string | null;
    startConferenceStartedAt: string;
    startConferenceCompletedAt: string;
    activeRunPublishedAt: string;
    timeoutMs: number;
  }) => Promise<BrowserJoinResult>;
  close: () => Promise<void>;
};

export type BrowserPrewarmFn = (
  input: BrowserPrewarmInput,
) => Promise<BrowserPrewarmHandle>;

/** @deprecated Prefer browserPrewarm + liveJoin. Kept for test mocks. */
export type BrowserJoinFn = (input: BrowserJoinInput) => Promise<BrowserJoinResult>;

function emptyTiming(): BrowserJoinTiming {
  return {
    browserPrewarmStartedAt: null,
    browserPrewarmCompletedAt: null,
    startConferenceStartedAt: null,
    startConferenceCompletedAt: null,
    activeRunPublishedAt: null,
    facilitatorAccessRequestedAt: null,
    participantAccessRequestedAt: null,
    facilitatorCallConnectedAt: null,
    participantCallConnectedAt: null,
    browserReleaseToFirstAccessMs: null,
    browserReleaseToFirstJoinMs: null,
    browserReleaseToBothJoinedMs: null,
    startConferenceToFirstAccessMs: null,
    startConferenceToFirstJoinMs: null,
    startConferenceToBothJoinedMs: null,
  };
}

function isExpired(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && nowMs >= t;
}

function defaultConferenceName(sessionId: string): string {
  return buildVoximplantConferenceName(sessionId);
}

type AccessJson = {
  roomNameOrConferenceName?: string;
  error?: string;
  errorCode?: string;
};

/**
 * Live Playwright prewarm + live-join implementation.
 * Tests inject mock BrowserPrewarmFn / BrowserJoinFn instead.
 */
export const playwrightBrowserPrewarm: BrowserPrewarmFn = async (input) => {
  const nowMs = input.nowMs ?? Date.now;
  const browserPrewarmStartedAt = new Date(nowMs()).toISOString();
  let facilitator = emptyBrowserContextEvidence("facilitator", input.sessionId);
  let participant = emptyBrowserContextEvidence("participant", input.sessionId);
  const preferredStrategy: AuthStrategy =
    input.facilitatorAuthStrategy ??
    (hasAuthSessionCookieHeader(input.facilitatorAuthCookie)
      ? "CANONICAL_COOKIE"
      : "UI_LOGIN");

  const evidence: Record<string, unknown> = {
    phase: "prewarm",
    appBaseUrlHost: (() => {
      try {
        return new URL(input.appBaseUrl).host;
      } catch {
        return "invalid";
      }
    })(),
    cookieName: "auth_session",
    cookieBindingMode: "URL_BOUND",
    secure: (() => {
      try {
        return new URL(input.appBaseUrl).protocol === "https:";
      } catch {
        return false;
      }
    })(),
    facilitatorAuthStrategy: preferredStrategy,
    participantAuthStrategy: "JOIN_TOKEN",
    participantCookieInstalled: false,
    authNestedFailureCode: null as AuthNestedFailureCode | null,
    redirectToLogin: false,
    authenticatedUserMatch: false,
    sessionAccess: false,
    finalPagePath: null as string | null,
    finalHost: null as string | null,
  };

  const { chromium } = await import("@playwright/test");
  let browser: import("@playwright/test").Browser | null = null;
  let facilitatorContext: import("@playwright/test").BrowserContext | null =
    null;
  let participantContext: import("@playwright/test").BrowserContext | null =
    null;
  let facilitatorPage: import("@playwright/test").Page | null = null;
  let participantPage: import("@playwright/test").Page | null = null;
  let browserRelayUsed = false;
  let closed = false;

  const releaseGates: {
    facilitator: (() => void) | null;
    participant: (() => void) | null;
  } = { facilitator: null, participant: null };

  const gatePromises = {
    facilitator: new Promise<void>((resolve) => {
      releaseGates.facilitator = resolve;
    }),
    participant: new Promise<void>((resolve) => {
      releaseGates.participant = resolve;
    }),
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    await facilitatorContext?.close().catch(() => {});
    await participantContext?.close().catch(() => {});
    await browser?.close().catch(() => {});
  };

  const failPrewarm = (
    code: BrowserFailureCode,
    role: "facilitator" | "participant" | "both",
    stage: BrowserStage,
  ): BrowserPrewarmHandle => {
    if (role === "facilitator" || role === "both") {
      facilitator = markFailed(facilitator, stage, code);
    }
    if (role === "participant" || role === "both") {
      participant = markFailed(participant, stage, code);
    }
    persistBrowserContextArtifacts({
      runId: input.runId,
      stateRoot: input.stateRoot,
      facilitator,
      participant,
      extra: evidence,
    });
    return {
      ok: false,
      failureCode: code,
      browserPrewarmStartedAt,
      browserPrewarmCompletedAt: new Date(nowMs()).toISOString(),
      facilitator,
      participant,
      evidence,
      liveJoin: async () => {
        throw new Error("prewarm failed; live join not available");
      },
      close,
    };
  };

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    facilitator = {
      ...facilitator,
      reachedStage: advanceStage(facilitator.reachedStage, "BROWSER_LAUNCHED"),
      mediaPermissionOk: true,
    };
    participant = {
      ...participant,
      reachedStage: advanceStage(participant.reachedStage, "BROWSER_LAUNCHED"),
      mediaPermissionOk: true,
    };

    facilitatorContext = await browser.newContext({
      permissions: ["microphone", "camera"],
      ignoreHTTPSErrors: true,
    });
    participantContext = await browser.newContext({
      permissions: ["microphone", "camera"],
      ignoreHTTPSErrors: true,
    });

    try {
      facilitatorPage = await facilitatorContext.newPage();
      participantPage = await participantContext.newPage();
    } catch (error) {
      evidence.prewarmError = redactBoundedErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      return failPrewarm(
        "BROWSER_PREWARM_FAILED",
        "both",
        "BROWSER_LAUNCHED",
      );
    }

    // Facilitator auth: canonical cookie first; UI login recovery otherwise.
    let authStrategy: AuthStrategy = preferredStrategy;
    if (
      hasAuthSessionCookieHeader(input.facilitatorAuthCookie) &&
      preferredStrategy === "CANONICAL_COOKIE"
    ) {
      const rawValue = parseCookieHeader(input.facilitatorAuthCookie!).value;
      if (isRawIdMistakenForAuthSession(rawValue)) {
        evidence.authNestedFailureCode = "AUTH_COOKIE_REJECTED";
        evidence.prewarmError =
          "auth_session value looks like a raw id, not a session token";
        return failPrewarm(
          "AUTH_COOKIE_REJECTED",
          "facilitator",
          "AUTH_CONTEXT_CREATED",
        );
      }
      try {
        const built = buildUrlBoundAuthCookie({
          cookieHeader: input.facilitatorAuthCookie!,
          appBaseUrl: input.appBaseUrl,
        });
        evidence.cookieBindingMode = built.bindingMode;
        evidence.appBaseUrlHost = built.appBaseUrlHost;
        evidence.secure = built.secure;
        evidence.cookieName = built.cookieName;
        evidence.facilitatorAuthStrategy = "CANONICAL_COOKIE";
        authStrategy = "CANONICAL_COOKIE";
        await facilitatorContext.addCookies([built.cookie]);
        facilitator = {
          ...facilitator,
          reachedStage: advanceStage(
            facilitator.reachedStage,
            "AUTH_CONTEXT_CREATED",
          ),
        };
      } catch (error) {
        const diag = buildAuthFailureDiagnostics({
          role: "facilitator",
          failingOperation: "addCookies",
          error,
          cookieBindingMode: "URL_BOUND",
          appBaseUrl: input.appBaseUrl,
          secure: Boolean(evidence.secure),
        });
        Object.assign(evidence, diag);
        evidence.prewarmError = diag.errorMessage;
        return failPrewarm(
          "AUTH_COOKIE_INSTALL_FAILED",
          "facilitator",
          "AUTH_CONTEXT_CREATED",
        );
      }
    } else if (
      input.facilitatorEmail &&
      input.facilitatorPassword &&
      (preferredStrategy === "UI_LOGIN" ||
        preferredStrategy === "LOGIN_API" ||
        !hasAuthSessionCookieHeader(input.facilitatorAuthCookie))
    ) {
      authStrategy = "UI_LOGIN";
      evidence.facilitatorAuthStrategy = "UI_LOGIN";
      const login = await installFacilitatorAuthViaUiLogin({
        page: facilitatorPage,
        appBaseUrl: input.appBaseUrl,
        email: input.facilitatorEmail,
        password: input.facilitatorPassword,
        timeoutMs: input.timeoutMs,
      });
      if (!login.ok) {
        evidence.authNestedFailureCode = "AUTH_COOKIE_REJECTED";
        evidence.prewarmError = login.boundedError;
        return failPrewarm(
          "FACILITATOR_AUTH_FAILED",
          "facilitator",
          "AUTH_CONTEXT_CREATED",
        );
      }
      facilitator = {
        ...facilitator,
        reachedStage: advanceStage(
          facilitator.reachedStage,
          "AUTH_CONTEXT_CREATED",
        ),
      };
    } else {
      evidence.authNestedFailureCode = "AUTH_COOKIE_MISSING";
      evidence.prewarmError =
        "no facilitatorAuthCookie and no UI login credentials";
      return failPrewarm(
        "AUTH_COOKIE_MISSING",
        "facilitator",
        "AUTH_CONTEXT_CREATED",
      );
    }

    // Participant: own auth_session + join-token invite URL (guest access closed).
    // Never install the facilitator cookie into the participant context.
    const joinToken = extractJoinTokenFromRoomUrl(input.participantRoomUrl);
    if (!joinToken) {
      evidence.prewarmError = "participant room URL missing joinToken";
      return failPrewarm(
        "PARTICIPANT_TOKEN_MISSING",
        "participant",
        "AUTH_CONTEXT_CREATED",
      );
    }
    try {
      prepareParticipantJoinContext({
        participantRoomUrl: input.participantRoomUrl,
      });
      evidence.participantAuthStrategy = "JOIN_TOKEN";
      if (!hasAuthSessionCookieHeader(input.participantAuthCookie)) {
        evidence.prewarmError =
          "participantAuthCookie missing (guest joinToken alone redirects to /login)";
        return failPrewarm(
          "PARTICIPANT_AUTH_ARTIFACT_MISSING",
          "participant",
          "AUTH_CONTEXT_CREATED",
        );
      }
      if (!input.participantUserId) {
        evidence.prewarmError = "participantUserId missing from prewarm input";
        return failPrewarm(
          "PARTICIPANT_AUTH_ARTIFACT_MISSING",
          "participant",
          "AUTH_CONTEXT_CREATED",
        );
      }
      const partBuilt = buildParticipantAuthCookieInstall({
        participantAuthCookie: input.participantAuthCookie!,
        appBaseUrl: input.appBaseUrl,
      });
      await participantContext.addCookies([partBuilt.cookie]);
      evidence.participantCookieInstalled = true;
      const participantCookies = await participantContext.cookies();
      const facCookieValue = hasAuthSessionCookieHeader(input.facilitatorAuthCookie)
        ? parseCookieHeader(input.facilitatorAuthCookie!).value
        : null;
      const inherited =
        Boolean(facCookieValue) &&
        participantCookies.some(
          (c) => c.name === "auth_session" && c.value === facCookieValue,
        );
      evidence.participantInheritedFacilitatorAuth = inherited;
      if (inherited) {
        evidence.prewarmError =
          "participant context inherited facilitator auth_session";
        return failPrewarm(
          "PARTICIPANT_CONTEXT_SETUP_FAILED",
          "participant",
          "AUTH_CONTEXT_CREATED",
        );
      }
      participant = {
        ...participant,
        reachedStage: advanceStage(
          participant.reachedStage,
          "AUTH_CONTEXT_CREATED",
        ),
      };
    } catch (error) {
      const diag = buildAuthFailureDiagnostics({
        role: "participant",
        failingOperation: "participant.addCookies",
        error,
        cookieBindingMode: "URL_BOUND",
        appBaseUrl: input.appBaseUrl,
        secure: Boolean(evidence.secure),
      });
      Object.assign(evidence, diag);
      evidence.prewarmError = diag.errorMessage;
      return failPrewarm(
        "PARTICIPANT_CONTEXT_SETUP_FAILED",
        "participant",
        "AUTH_CONTEXT_CREATED",
      );
    }

    const attachDiagnostics = (
      page: import("@playwright/test").Page,
      role: "facilitator" | "participant",
    ) => {
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = sanitizeConsoleMessage(msg.text());
          if (role === "facilitator") facilitator.consoleErrors.push(text);
          else participant.consoleErrors.push(text);
        }
      });
      page.on("pageerror", (err) => {
        const text = sanitizeConsoleMessage(err.message);
        if (role === "facilitator") facilitator.pageErrors.push(text);
        else participant.pageErrors.push(text);
      });
      page.on("requestfailed", (req) => {
        try {
          const path = new URL(req.url()).pathname;
          if (role === "facilitator") facilitator.failedRequestPaths.push(path);
          else participant.failedRequestPaths.push(path);
        } catch {
          // ignore
        }
      });
      page.on("request", (req) => {
        const url = req.url();
        if (
          url.includes("/recording-control") &&
          req.method() === "POST" &&
          (req.postData()?.includes('"action":"stop"') ||
            req.postData()?.includes('"action":"relay_stop"'))
        ) {
          browserRelayUsed = true;
        }
      });
    };
    attachDiagnostics(facilitatorPage, "facilitator");
    attachDiagnostics(participantPage, "participant");

    // Hold access until LIVE phase; allow other requests.
    const installAccessGate = async (
      page: import("@playwright/test").Page,
      role: "facilitator" | "participant",
    ) => {
      await page.route("**/api/sessions/*/voximplant/access**", async (route) => {
        await gatePromises[role];
        await route.continue();
      });
    };
    await installAccessGate(facilitatorPage, "facilitator");
    await installAccessGate(participantPage, "participant");

    // Deterministic local auth verification on protected Session page.
    const authVerify = await verifyFacilitatorAuthInContext({
      context: facilitatorContext,
      appBaseUrl: input.appBaseUrl,
      sessionId: input.sessionId,
      expectedUserId: input.facilitatorUserId,
      expectedEmail: input.facilitatorEmail,
      authenticationStrategy: authStrategy,
      timeoutMs: input.timeoutMs,
      sessionExists: input.sessionExists !== false,
    });
    Object.assign(evidence, {
      facilitatorAuthStrategy: authVerify.diagnostics.authenticationStrategy,
      authNestedFailureCode: authVerify.diagnostics.nestedFailureCode,
      finalPagePath: authVerify.diagnostics.finalPagePath,
      finalHost: authVerify.diagnostics.finalHost,
      redirectToLogin: authVerify.diagnostics.redirectToLogin,
      authenticatedUserMatch: authVerify.diagnostics.authenticatedUserMatch,
      sessionAccess: authVerify.diagnostics.sessionAccess,
      authSessionCookiePresent: authVerify.diagnostics.authSessionCookiePresent,
      authVerifyHttpStatus: authVerify.diagnostics.httpStatus,
    });
    if (!authVerify.ok) {
      evidence.prewarmError = authVerify.diagnostics.boundedError;
      const code = nestedToBrowserFailure(authVerify.nestedFailureCode);
      return failPrewarm(code, "facilitator", "AUTH_ACCEPTED");
    }

    facilitator = {
      ...facilitator,
      authAccepted: true,
      pageUrlPath: authVerify.diagnostics.finalPagePath,
      reachedStage: advanceStage(facilitator.reachedStage, "AUTH_ACCEPTED"),
    };
    evidence.phase = "FACILITATOR_AUTH_ACCEPTED";

    let facilitatorAuthCookieHeader: string | null = null;
    try {
      const cookies = await facilitatorContext.cookies();
      const auth = cookies.find((c) => c.name === "auth_session");
      if (auth?.value) {
        facilitatorAuthCookieHeader = `auth_session=${auth.value}`;
      }
    } catch {
      facilitatorAuthCookieHeader = hasAuthSessionCookieHeader(
        input.facilitatorAuthCookie,
      )
        ? input.facilitatorAuthCookie!
        : null;
    }

    // Navigate rooms with access gated (prewarm stops before access/WebSDK).
    facilitator = {
      ...facilitator,
      reachedStage: advanceStage(
        facilitator.reachedStage,
        "ROOM_NAVIGATION_STARTED",
      ),
    };
    participant = {
      ...participant,
      reachedStage: advanceStage(
        participant.reachedStage,
        "ROOM_NAVIGATION_STARTED",
      ),
    };

    try {
      await facilitatorPage.goto(input.facilitatorRoomUrl, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(input.timeoutMs, 30_000),
      });
    } catch (error) {
      evidence.prewarmError = redactBoundedErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      evidence.failingOperation = "facilitator.page.goto";
      return failPrewarm(
        "ROOM_PAGE_FAILED",
        "facilitator",
        "ROOM_NAVIGATION_STARTED",
      );
    }

    // Canonical participant entry: join-token URL once with participant auth.
    // App validates invite, lands on durable account-mode /room/{sessionId}.
    try {
      await participantPage.goto(input.participantRoomUrl, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(input.timeoutMs, 30_000),
      });
    } catch (error) {
      evidence.prewarmError = redactBoundedErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      evidence.failingOperation = "participant.page.goto";
      return failPrewarm(
        "PARTICIPANT_ROOM_NOT_LOADED",
        "participant",
        "ROOM_NAVIGATION_STARTED",
      );
    }

    facilitator.pageUrlPath = sanitizePageUrl(facilitatorPage.url());
    const participantNav = classifyParticipantNavigation({
      finalUrl: participantPage.url(),
      appBaseUrl: input.appBaseUrl,
      sessionId: input.sessionId,
      joinTokenPresentInStartUrl: Boolean(joinToken),
    });
    participant.pageUrlPath = participantNav.finalPagePath;
    evidence.participantFinalPagePath = participantNav.finalPagePath;
    evidence.participantFinalHost = participantNav.finalHost;
    evidence.participantRedirectToLogin = participantNav.redirectToLogin;
    evidence.participantDurableRoomUrl = participantNav.durableAccountRoomUrl;

    if (/\/login/i.test(facilitator.pageUrlPath ?? "")) {
      evidence.authNestedFailureCode = "AUTH_REDIRECTED_TO_LOGIN";
      return failPrewarm(
        "AUTH_REDIRECTED_TO_LOGIN",
        "facilitator",
        "ROOM_PAGE_LOADED",
      );
    }

    if (!participantNav.ok) {
      evidence.prewarmError = participantNav.boundedError;
      return failPrewarm(
        participantNav.failureCode ?? "PARTICIPANT_CONTEXT_NOT_ESTABLISHED",
        "participant",
        "ROOM_PAGE_LOADED",
      );
    }

    // Prefer durable account URL for live resume (do not re-hit joinToken).
    if (!/\/room\/[^/]+$/.test(new URL(participantPage.url()).pathname)) {
      await participantPage
        .goto(participantNav.durableAccountRoomUrl, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(input.timeoutMs, 20_000),
        })
        .catch(() => {});
      participant.pageUrlPath = sanitizePageUrl(participantPage.url());
    }

    // Canonical participant auth verification before StartConference / live join.
    const partAuthVerify = await verifyParticipantAuthInContext({
      context: participantContext,
      appBaseUrl: input.appBaseUrl,
      sessionId: input.sessionId,
      expectedParticipantUserId: input.participantUserId!,
      expectedParticipantEmail: input.participantEmail,
      facilitatorUserId: input.facilitatorUserId,
      facilitatorAuthCookie: input.facilitatorAuthCookie,
      timeoutMs: input.timeoutMs,
      sessionExists: input.sessionExists !== false,
    });
    Object.assign(evidence, {
      participantAuthVerified: partAuthVerify.ok,
      participantFinalPagePath: partAuthVerify.diagnostics.finalPagePath,
      participantFinalHost: partAuthVerify.diagnostics.finalHost,
      participantRedirectToLogin: partAuthVerify.diagnostics.redirectToLogin,
      participantAuthenticatedUserMatch:
        partAuthVerify.diagnostics.authenticatedUserMatch,
      participantSessionAccess: partAuthVerify.diagnostics.sessionAccess,
      participantIsFacilitatorIdentity:
        partAuthVerify.diagnostics.isFacilitatorIdentity,
      participantAuthVerifyHttpStatus: partAuthVerify.diagnostics.httpStatus,
    });
    if (!partAuthVerify.ok) {
      evidence.prewarmError = partAuthVerify.diagnostics.boundedError;
      return failPrewarm(
        partAuthVerify.failureCode ?? "PARTICIPANT_AUTH_FAILED",
        "participant",
        "AUTH_ACCEPTED",
      );
    }

    facilitator = {
      ...facilitator,
      roomPageLoaded: true,
      authAccepted: true,
      reachedStage: advanceStage(facilitator.reachedStage, "ROOM_PAGE_LOADED"),
    };
    participant = {
      ...participant,
      roomPageLoaded: true,
      authAccepted: true,
      reachedStage: advanceStage(participant.reachedStage, "ROOM_PAGE_LOADED"),
    };
    evidence.participantPreparation = "PARTICIPANT_CONTEXT_READY";
    evidence.participantRoomLoaded = true;

    // Prewarm-only: both contexts ready; stop before access/WebSDK.
    if (input.prewarmOnly) {
      evidence.phase = "BROWSER_PREWARM_PASS";
      const browserPrewarmCompletedAt = new Date(nowMs()).toISOString();
      persistBrowserContextArtifacts({
        runId: input.runId,
        stateRoot: input.stateRoot,
        facilitator,
        participant,
        extra: evidence,
      });
      return {
        ok: true,
        failureCode: null,
        browserPrewarmStartedAt,
        browserPrewarmCompletedAt,
        facilitator,
        participant,
        evidence,
        facilitatorAuthCookieHeader,
        close,
        liveJoin: async () => {
          throw new Error("prewarm-only mode; live join not available");
        },
      };
    }

    const browserPrewarmCompletedAt = new Date(nowMs()).toISOString();
    evidence.phase = "prewarm_ready";
    const participantLiveRoomUrl = participantNav.durableAccountRoomUrl;

    return {
      ok: true,
      failureCode: null,
      browserPrewarmStartedAt,
      browserPrewarmCompletedAt,
      facilitator,
      participant,
      evidence,
      close,
      liveJoin: async (live) => {
        const timing: BrowserJoinTiming = {
          ...emptyTiming(),
          browserPrewarmStartedAt,
          browserPrewarmCompletedAt,
          startConferenceStartedAt: live.startConferenceStartedAt,
          startConferenceCompletedAt: live.startConferenceCompletedAt,
          activeRunPublishedAt: live.activeRunPublishedAt,
        };

        const startCompletedMs = Date.parse(live.startConferenceCompletedAt);
        const expiredBeforeAccess = isExpired(live.expiresAt, nowMs());

        if (expiredBeforeAccess) {
          facilitator = markFailed(
            facilitator,
            "ACCESS_REQUEST_SENT",
            "MEDIA_SESSION_EXPIRED_BEFORE_ACCESS",
          );
          participant = markFailed(
            participant,
            "ACCESS_REQUEST_SENT",
            "MEDIA_SESSION_EXPIRED_BEFORE_ACCESS",
          );
          const dirs = persistBrowserContextArtifacts({
            runId: input.runId,
            stateRoot: input.stateRoot,
            facilitator,
            participant,
          });
          evidence.artifactDirs = dirs;
          return {
            facilitatorJoined: false,
            participantJoined: false,
            sameConferenceConfirmed: false,
            facilitatorConferenceName: null,
            participantConferenceName: null,
            browserRelayUsed,
            failureCode: "MEDIA_SESSION_EXPIRED_BEFORE_ACCESS",
            facilitator,
            participant,
            timing,
            evidence,
            close,
          };
        }

        const accessPathNeedle = `/api/sessions/${input.sessionId}/voximplant/access`;

        type AccessProbe = {
          requestObserved: boolean;
          requestAt: string | null;
          responseAt: string | null;
          status: number | null;
          aborted: boolean;
          abortReason: string | null;
          redirected: boolean;
          redirectLocationPath: string | null;
          json: AccessJson | null;
        };

        const installAccessObservers = (
          page: import("@playwright/test").Page,
        ): {
          probe: AccessProbe;
          responsePromise: Promise<import("@playwright/test").Response | null>;
          dispose: () => void;
        } => {
          const probe: AccessProbe = {
            requestObserved: false,
            requestAt: null,
            responseAt: null,
            status: null,
            aborted: false,
            abortReason: null,
            redirected: false,
            redirectLocationPath: null,
            json: null,
          };
          const onRequest = (req: import("@playwright/test").Request) => {
            if (!req.url().includes(accessPathNeedle)) return;
            probe.requestObserved = true;
            probe.requestAt = new Date(nowMs()).toISOString();
          };
          const onRequestFailed = (req: import("@playwright/test").Request) => {
            if (!req.url().includes(accessPathNeedle)) return;
            probe.requestObserved = true;
            probe.aborted = true;
            probe.abortReason = redactBoundedErrorMessage(
              req.failure()?.errorText ?? "requestfailed",
            );
            if (!probe.requestAt) {
              probe.requestAt = new Date(nowMs()).toISOString();
            }
          };
          page.on("request", onRequest);
          page.on("requestfailed", onRequestFailed);
          const responsePromise = page
            .waitForResponse(
              (resp) => resp.url().includes(accessPathNeedle),
              { timeout: live.timeoutMs },
            )
            .then(async (resp) => {
              probe.responseAt = new Date(nowMs()).toISOString();
              probe.status = resp.status();
              if (resp.status() >= 300 && resp.status() < 400) {
                probe.redirected = true;
                const loc = resp.headers()["location"];
                if (loc) {
                  try {
                    probe.redirectLocationPath = sanitizePageUrl(
                      new URL(loc, input.appBaseUrl).toString(),
                    );
                  } catch {
                    probe.redirectLocationPath = "/[invalid-redirect]";
                  }
                }
              }
              probe.json = (await resp.json().catch(() => null)) as AccessJson | null;
              return resp;
            })
            .catch(() => null);
          return {
            probe,
            responsePromise,
            dispose: () => {
              page.off("request", onRequest);
              page.off("requestfailed", onRequestFailed);
            },
          };
        };

        // Install observers BEFORE releasing access gates so fast responses are not missed.
        const facObservers = installAccessObservers(facilitatorPage!);
        const partObservers = installAccessObservers(participantPage!);

        // Release both access gates concurrently.
        releaseGates.facilitator?.();
        releaseGates.participant?.();

        const runAccess = async (
          page: import("@playwright/test").Page,
          role: "facilitator" | "participant",
          observers: ReturnType<typeof installAccessObservers>,
        ): Promise<string | null> => {
          let ctx =
            role === "facilitator" ? facilitator : participant;

          // Resume durable room context — participant uses account-mode URL
          // (no second joinToken navigation).
          const targetUrl =
            role === "facilitator"
              ? input.facilitatorRoomUrl
              : participantLiveRoomUrl;
          const onRoom = /\/room\//i.test(page.url());
          try {
            if (onRoom) {
              await page.reload({
                waitUntil: "domcontentloaded",
                timeout: live.timeoutMs,
              });
            } else {
              await page.goto(targetUrl, {
                waitUntil: "domcontentloaded",
                timeout: live.timeoutMs,
              });
            }
          } catch (error) {
            observers.dispose();
            const message = redactBoundedErrorMessage(
              error instanceof Error ? error.message : String(error),
            );
            ctx = markFailed(
              {
                ...ctx,
                pageUrlPath: sanitizePageUrl(page.url()),
                access: {
                  ...(ctx.access ?? emptyBrowserContextEvidence(role, input.sessionId).access!),
                  requestObserved: observers.probe.requestObserved,
                  requestAt: observers.probe.requestAt,
                  responseAt: observers.probe.responseAt,
                  abortReason: message,
                },
              },
              observers.probe.requestObserved
                ? "ACCESS_REQUEST_SENT"
                : "ROOM_PAGE_LOADED",
              role === "participant"
                ? classifyParticipantAccessFailure({
                    requestObserved: observers.probe.requestObserved,
                    aborted: true,
                    timedOut: false,
                    redirected: false,
                    httpStatus: null,
                  })
                : "ROOM_PAGE_FAILED",
            );
            if (role === "facilitator") facilitator = ctx;
            else participant = ctx;
            return null;
          }

          const response = await observers.responsePromise;
          observers.dispose();
          const probe = observers.probe;

          // ACCESS_REQUEST_SENT only when a real request event was observed.
          if (probe.requestObserved) {
            ctx = {
              ...ctx,
              accessRequested: true,
              accessRequestedAt: probe.requestAt,
              reachedStage: advanceStage(ctx.reachedStage, "ACCESS_REQUEST_SENT"),
            };
            if (role === "facilitator") {
              timing.facilitatorAccessRequestedAt = probe.requestAt;
            } else {
              timing.participantAccessRequestedAt = probe.requestAt;
            }
          } else {
            ctx = markFailed(
              {
                ...ctx,
                pageUrlPath: sanitizePageUrl(page.url()),
                access: {
                  ...(ctx.access ??
                    emptyBrowserContextEvidence(role, input.sessionId).access!),
                  requestObserved: false,
                  requestAt: null,
                  responseAt: null,
                  abortReason: "no access request observed",
                },
              },
              "ACCESS_REQUEST_SENT",
              role === "participant"
                ? "PARTICIPANT_ACCESS_NOT_REQUESTED"
                : "ACCESS_ROUTE_FAILED",
            );
            if (role === "facilitator") facilitator = ctx;
            else participant = ctx;
            return null;
          }

          if (!response) {
            ctx = markFailed(
              {
                ...ctx,
                pageUrlPath: sanitizePageUrl(page.url()),
                access: {
                  ...(ctx.access ??
                    emptyBrowserContextEvidence(role, input.sessionId).access!),
                  requestObserved: true,
                  requestAt: probe.requestAt,
                  responseAt: probe.responseAt,
                  abortReason: probe.abortReason ?? "response timeout",
                },
              },
              "ACCESS_REQUEST_SENT",
              role === "participant"
                ? classifyParticipantAccessFailure({
                    requestObserved: true,
                    aborted: probe.aborted,
                    timedOut: !probe.aborted,
                    redirected: probe.redirected,
                    httpStatus: probe.status,
                  })
                : "ACCESS_ROUTE_FAILED",
            );
            if (role === "facilitator") facilitator = ctx;
            else participant = ctx;
            return null;
          }

          const json = probe.json;
          const status = probe.status ?? response.status();
          const name = json?.roomNameOrConferenceName ?? null;
          const pointer = readCurrentPointer(input.stateRoot);
          const state = readPocState(input.stateRoot);
          const runtime = state
            ? resolveRuntimeStatus(state, nowMs())
            : null;
          const defaultName = defaultConferenceName(input.sessionId);
          const selectionSource =
            name === live.expectedConferenceName
              ? ("POC_STATE" as const)
              : name === defaultName
                ? ("DEFAULT_SESSION_NAME" as const)
                : name
                  ? ("POC_STATE" as const)
                  : null;

          ctx = {
            ...ctx,
            pageUrlPath: sanitizePageUrl(page.url()),
            access: {
              requestPath: accessPathNeedle,
              httpStatus: status,
              applicationErrorCode: json?.errorCode ?? json?.error ?? null,
              requestedSessionId: input.sessionId,
              linkedSessionIdMatch: pointer
                ? pointer.linkedSessionId === input.sessionId
                : null,
              activeRunId: pointer?.runId ?? null,
              selectedConferenceName: name,
              selectionSource,
              runtimeStatus: runtime,
              expiryDecision:
                runtime === "EXPIRED"
                  ? "EXPIRED"
                  : runtime === "ACTIVE"
                    ? "ACTIVE"
                    : "UNKNOWN",
              requestObserved: true,
              requestAt: probe.requestAt,
              responseAt: probe.responseAt,
              abortReason: probe.abortReason,
              redirectLocationPath: probe.redirectLocationPath,
            },
          };

          if (status !== 200) {
            const accessFail =
              role === "participant"
                ? classifyParticipantAccessFailure({
                    requestObserved: true,
                    aborted: false,
                    timedOut: false,
                    redirected: probe.redirected,
                    httpStatus: status,
                  })
                : classifyAccessHttpStatus(status);
            ctx = markFailed(ctx, "ACCESS_REQUEST_SUCCEEDED", accessFail);
          } else {
            ctx = {
              ...ctx,
              reachedStage: advanceStage(
                ctx.reachedStage,
                "ACCESS_REQUEST_SUCCEEDED",
              ),
            };
            if (name === live.expectedConferenceName) {
              ctx = {
                ...ctx,
                reachedStage: advanceStage(
                  ctx.reachedStage,
                  "POC_CONFERENCE_SELECTED",
                ),
              };
            } else if (name === defaultName || selectionSource === "DEFAULT_SESSION_NAME") {
              ctx = markFailed(
                ctx,
                "POC_CONFERENCE_SELECTED",
                "ACCESS_SELECTED_DEFAULT_CONFERENCE",
              );
            } else {
              ctx = markFailed(
                ctx,
                "POC_CONFERENCE_SELECTED",
                "ACCESS_SELECTED_DEFAULT_CONFERENCE",
              );
            }
          }

          // Best-effort SDK/join diagnostics from window hook.
          const diag = await page
            .evaluate(() => {
              const w = window as unknown as {
                __VOX_SERVER_STOP_POC_DIAG__?: {
                  conferenceName?: string;
                  joined?: boolean;
                  sdkInitialized?: boolean;
                  loginSucceeded?: boolean;
                  callConnected?: boolean;
                };
              };
              return w.__VOX_SERVER_STOP_POC_DIAG__ ?? null;
            })
            .catch(() => null);

          if (diag?.sdkInitialized) {
            ctx = {
              ...ctx,
              sdkInitialized: true,
              reachedStage: advanceStage(
                ctx.reachedStage,
                "VOX_SDK_INITIALIZED",
              ),
            };
          }
          if (diag?.loginSucceeded) {
            ctx = {
              ...ctx,
              reachedStage: advanceStage(
                ctx.reachedStage,
                "VOX_LOGIN_SUCCEEDED",
              ),
            };
          }
          if (diag?.callConnected) {
            const at = new Date(nowMs()).toISOString();
            ctx = {
              ...ctx,
              callConnected: true,
              callConnectedAt: at,
              reachedStage: advanceStage(ctx.reachedStage, "CALL_CONNECTED"),
            };
          }
          if (diag?.joined || name === live.expectedConferenceName) {
            // Access selecting POC conference is necessary but not sufficient;
            // treat diag.joined as JOIN_CONFIRMED, else CONFERENCE_JOINED soft.
            if (diag?.joined) {
              ctx = {
                ...ctx,
                joined: true,
                reachedStage: advanceStage(ctx.reachedStage, "JOIN_CONFIRMED"),
              };
            } else if (name === live.expectedConferenceName) {
              ctx = {
                ...ctx,
                reachedStage: advanceStage(
                  ctx.reachedStage,
                  "CONFERENCE_JOINED",
                ),
                // Without SDK diag, conference selection is the strongest signal.
                joined: true,
              };
            }
          }

          if (role === "facilitator") {
            facilitator = ctx;
            timing.facilitatorCallConnectedAt = ctx.callConnectedAt;
          } else {
            participant = ctx;
            timing.participantCallConnectedAt = ctx.callConnectedAt;
          }
          return name;
        };

        let facilitatorConferenceName: string | null = null;
        let participantConferenceName: string | null = null;

        try {
          const results = await Promise.allSettled([
            runAccess(facilitatorPage!, "facilitator", facObservers),
            runAccess(participantPage!, "participant", partObservers),
          ]);
          if (results[0].status === "fulfilled") {
            facilitatorConferenceName = results[0].value;
          } else {
            facilitator = markFailed(
              facilitator,
              facilitator.reachedStage,
              isExpired(live.expiresAt, nowMs())
                ? "MEDIA_SESSION_EXPIRED_DURING_JOIN"
                : "CONFERENCE_JOIN_TIMEOUT",
            );
          }
          if (results[1].status === "fulfilled") {
            participantConferenceName = results[1].value;
          } else {
            participant = markFailed(
              participant,
              participant.reachedStage,
              isExpired(live.expiresAt, nowMs())
                ? "MEDIA_SESSION_EXPIRED_DURING_JOIN"
                : "CONFERENCE_JOIN_TIMEOUT",
            );
          }
        } catch (error) {
          evidence.liveError =
            error instanceof Error ? error.message : String(error);
        }

        const expiredDuringJoin =
          !expiredBeforeAccess && isExpired(live.expiresAt, nowMs());
        if (
          expiredDuringJoin &&
          (!facilitator.joined || !participant.joined)
        ) {
          if (!facilitator.joined) {
            facilitator = markFailed(
              facilitator,
              facilitator.firstFailedStage ?? "CALL_CONNECTED",
              "MEDIA_SESSION_EXPIRED_DURING_JOIN",
            );
          }
          if (!participant.joined) {
            participant = markFailed(
              participant,
              participant.firstFailedStage ?? "CALL_CONNECTED",
              "MEDIA_SESSION_EXPIRED_DURING_JOIN",
            );
          }
        }

        // Timeouts when access selected POC but join not confirmed in budget.
        if (
          facilitatorConferenceName === live.expectedConferenceName &&
          !facilitator.joined &&
          !facilitator.failureCode
        ) {
          facilitator = markFailed(
            facilitator,
            "JOIN_CONFIRMED",
            "CONFERENCE_JOIN_TIMEOUT",
          );
        }
        if (
          participantConferenceName === live.expectedConferenceName &&
          !participant.joined &&
          !participant.failureCode
        ) {
          participant = markFailed(
            participant,
            "JOIN_CONFIRMED",
            "CONFERENCE_JOIN_TIMEOUT",
          );
        }

        const sameConferenceConfirmed =
          facilitatorConferenceName === live.expectedConferenceName &&
          participantConferenceName === live.expectedConferenceName;

        // Persist join from access match when expected POC conference selected.
        if (sameConferenceConfirmed) {
          facilitator = {
            ...facilitator,
            joined: true,
            reachedStage: advanceStage(
              facilitator.reachedStage,
              "JOIN_CONFIRMED",
            ),
          };
          participant = {
            ...participant,
            joined: true,
            reachedStage: advanceStage(
              participant.reachedStage,
              "JOIN_CONFIRMED",
            ),
          };
        }

        const firstAccessMs = [
          timing.facilitatorAccessRequestedAt,
          timing.participantAccessRequestedAt,
        ]
          .filter(Boolean)
          .map((v) => Date.parse(v!))
          .filter((n) => Number.isFinite(n));
        if (firstAccessMs.length && Number.isFinite(startCompletedMs)) {
          const value = Math.min(...firstAccessMs) - startCompletedMs;
          timing.browserReleaseToFirstAccessMs = value;
          timing.startConferenceToFirstAccessMs = value;
        }
        const firstJoinMs = [
          timing.facilitatorCallConnectedAt,
          timing.participantCallConnectedAt,
        ]
          .filter(Boolean)
          .map((v) => Date.parse(v!))
          .filter((n) => Number.isFinite(n));
        if (firstJoinMs.length && Number.isFinite(startCompletedMs)) {
          const value = Math.min(...firstJoinMs) - startCompletedMs;
          timing.browserReleaseToFirstJoinMs = value;
          timing.startConferenceToFirstJoinMs = value;
        }
        if (
          facilitator.joined &&
          participant.joined &&
          Number.isFinite(startCompletedMs)
        ) {
          const bothAt = Math.max(
            Date.parse(
              timing.facilitatorCallConnectedAt ??
                timing.facilitatorAccessRequestedAt ??
                live.startConferenceCompletedAt,
            ),
            Date.parse(
              timing.participantCallConnectedAt ??
                timing.participantAccessRequestedAt ??
                live.startConferenceCompletedAt,
            ),
          );
          const value = bothAt - startCompletedMs;
          timing.browserReleaseToBothJoinedMs = value;
          timing.startConferenceToBothJoinedMs = value;
        }

        const failureCode =
          facilitator.joined && participant.joined && sameConferenceConfirmed
            ? null
            : classifyBrowserFailure({
                facilitator,
                participant,
                mediaSessionExpiredBeforeAccess: expiredBeforeAccess,
                mediaSessionExpiredDuringJoin: expiredDuringJoin,
              });

        if (failureCode) {
          const dirs = getBrowserDirsAndPersist();
          evidence.artifactDirs = dirs;
          // Screenshots best-effort
          await saveScreenshots();
        }

        function getBrowserDirsAndPersist() {
          return persistBrowserContextArtifacts({
            runId: input.runId,
            stateRoot: input.stateRoot,
            facilitator,
            participant,
            extra: { browserRelayUsed },
          });
        }

        async function saveScreenshots() {
          const dirs = persistBrowserContextArtifacts({
            runId: input.runId,
            stateRoot: input.stateRoot,
            facilitator,
            participant,
          });
          mkdirSync(dirs.facilitatorDir, { recursive: true });
          mkdirSync(dirs.participantDir, { recursive: true });
          await facilitatorPage
            ?.screenshot({
              path: join(dirs.facilitatorDir, "screenshot.png"),
              fullPage: true,
            })
            .catch(() => {});
          await participantPage
            ?.screenshot({
              path: join(dirs.participantDir, "screenshot.png"),
              fullPage: true,
            })
            .catch(() => {});
        }

        return {
          facilitatorJoined: facilitator.joined,
          participantJoined: participant.joined,
          sameConferenceConfirmed,
          facilitatorConferenceName,
          participantConferenceName,
          browserRelayUsed,
          failureCode,
          facilitator,
          participant,
          timing,
          evidence: {
            ...evidence,
            facilitatorAccessConference: facilitatorConferenceName,
            participantAccessConference: participantConferenceName,
          },
          startRecordingViaUi: async (timeoutMs: number) => {
            if (!facilitatorPage) {
              return {
                started: false,
                evidence: { error: "facilitator page unavailable" },
              };
            }
            return startRecordingViaUi({ page: facilitatorPage, timeoutMs });
          },
          relayScenarioMessage: async (
            relayInput: BrowserRelayRecordingStartInput,
          ) => {
            if (!facilitatorPage) {
              return {
                ok: false,
                recordingBrowserCommandClaimedAt: null,
                recordingBrowserCommandReceivedAt: null,
                recordingBrowserContextRole: null,
                recordingBrowserContextId: null,
                callReferenceFound: false,
                callReferenceSource: "NOT_FOUND",
                callConnected: false,
                callIdSanitized: null,
                callState: null,
                conferenceName: null,
                recordingBrowserCallReferenceFound: false,
                recordingBrowserCallReferenceSource: "NOT_FOUND",
                recordingBrowserCallConnected: false,
                recordingBrowserCallIdSanitized: null,
                recordingBrowserCallId: null,
                recordingBrowserCallState: null,
                recordingBrowserConferenceName: null,
                recordingBrowserSendMessageInvokedAt: null,
                recordingBrowserSendMessageCompletedAt: null,
                recordingBrowserSendMessageErrorCode:
                  "RECORDING_START_BROWSER_SEND_NOT_INVOKED",
                relayOwnerRole: null,
                relayOwnerParticipantId: null,
                relayOwnerConnectionId: null,
                relayClaimedAt: null,
                relayConsumedAt: null,
                recordingBrowserCommandSentAt: null,
                operationId: relayInput.operationId ?? null,
                errorCode: "RECORDING_START_BROWSER_SEND_NOT_INVOKED",
              };
            }
            const payload: BrowserRelayRecordingStartInput = {
              scenarioMessage: relayInput.scenarioMessage,
              operationId: relayInput.operationId ?? null,
              expectedSessionId: relayInput.expectedSessionId ?? input.sessionId,
              expectedConferenceName:
                relayInput.expectedConferenceName ?? live.expectedConferenceName,
            };
            try {
              return await facilitatorPage.evaluate(async (relayPayload) => {
                const w = window as unknown as {
                  __voxPocRelayRecordingStart?: (
                    input: unknown,
                  ) => Promise<BrowserRelayRecordingStartResult>;
                };
                if (typeof w.__voxPocRelayRecordingStart === "function") {
                  return await w.__voxPocRelayRecordingStart(relayPayload);
                }
                return {
                  ok: false,
                  recordingBrowserCommandClaimedAt: null,
                  recordingBrowserCommandReceivedAt: null,
                  recordingBrowserContextRole: null,
                  recordingBrowserContextId: null,
                  callReferenceFound: false,
                  callReferenceSource: "NOT_FOUND",
                  callConnected: false,
                  callIdSanitized: null,
                  callState: null,
                  conferenceName: null,
                  recordingBrowserCallReferenceFound: false,
                  recordingBrowserCallReferenceSource: "NOT_FOUND",
                  recordingBrowserCallConnected: false,
                  recordingBrowserCallIdSanitized: null,
                  recordingBrowserCallId: null,
                  recordingBrowserCallState: null,
                  recordingBrowserConferenceName: null,
                  recordingBrowserSendMessageInvokedAt: null,
                  recordingBrowserSendMessageCompletedAt: null,
                  recordingBrowserSendMessageErrorCode:
                    "RECORDING_START_BROWSER_SEND_NOT_INVOKED",
                  relayOwnerRole: null,
                  relayOwnerParticipantId: null,
                  relayOwnerConnectionId: null,
                  relayClaimedAt: null,
                  relayConsumedAt: null,
                  recordingBrowserCommandSentAt: null,
                  operationId: null,
                  errorCode: "RECORDING_START_BROWSER_SEND_NOT_INVOKED",
                };
              }, payload);
            } catch (error) {
              return {
                ok: false,
                recordingBrowserCommandClaimedAt: null,
                recordingBrowserCommandReceivedAt: null,
                recordingBrowserContextRole: null,
                recordingBrowserContextId: null,
                callReferenceFound: false,
                callReferenceSource: "NOT_FOUND",
                callConnected: false,
                callIdSanitized: null,
                callState: null,
                conferenceName: null,
                recordingBrowserCallReferenceFound: false,
                recordingBrowserCallReferenceSource: "NOT_FOUND",
                recordingBrowserCallConnected: false,
                recordingBrowserCallIdSanitized: null,
                recordingBrowserCallId: null,
                recordingBrowserCallState: null,
                recordingBrowserConferenceName: null,
                recordingBrowserSendMessageInvokedAt: null,
                recordingBrowserSendMessageCompletedAt: null,
                recordingBrowserSendMessageErrorCode:
                  "RECORDING_START_BROWSER_SEND_FAILED",
                relayOwnerRole: null,
                relayOwnerParticipantId: null,
                relayOwnerConnectionId: null,
                relayClaimedAt: null,
                relayConsumedAt: null,
                recordingBrowserCommandSentAt: null,
                operationId: relayInput.operationId ?? null,
                errorCode:
                  error instanceof Error
                    ? `RECORDING_START_BROWSER_SEND_FAILED:${error.name}`
                    : "RECORDING_START_BROWSER_SEND_FAILED",
              };
            }
          },
          close: async () => {
            if (!input.keepBrowser) await close();
          },
        };
      },
    };
  } catch (error) {
    const message = redactBoundedErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    evidence.prewarmError = message;
    evidence.failingOperation = evidence.failingOperation ?? "prewarm";
    evidence.errorName =
      error instanceof Error ? error.name || "Error" : "Error";
    evidence.errorMessage = message;
    // Cookie install / participant setup have dedicated handlers above.
    // Remaining launch/context failures stay on BROWSER_LAUNCHED.
    const stage: BrowserStage =
      facilitator.reachedStage === "BROWSER_NOT_LAUNCHED"
        ? "BROWSER_NOT_LAUNCHED"
        : "BROWSER_LAUNCHED";
    return failPrewarm("BROWSER_PREWARM_FAILED", "both", stage);
  }
};

/**
 * Compatibility wrapper: prewarm is skipped (not recommended).
 * Prefer playwrightBrowserPrewarm in the orchestrator.
 */
export const playwrightBrowserJoin: BrowserJoinFn = async (input) => {
  const runId = input.runId ?? `adhoc-${Date.now()}`;
  const prewarm = await playwrightBrowserPrewarm({
    appBaseUrl: input.appBaseUrl,
    sessionId: input.sessionId,
    facilitatorRoomUrl: input.facilitatorRoomUrl,
    participantRoomUrl: input.participantRoomUrl,
    facilitatorAuthCookie: input.facilitatorAuthCookie,
    facilitatorUserId: "unknown-facilitator",
    facilitatorAuthStrategy: "CANONICAL_COOKIE",
    participantAuthCookie: input.participantAuthCookie,
    timeoutMs: input.timeoutMs,
    keepBrowser: input.keepBrowser,
    runId,
    stateRoot: input.stateRoot,
    nowMs: input.nowMs,
  });
  if (!prewarm.ok) {
    return {
      facilitatorJoined: false,
      participantJoined: false,
      sameConferenceConfirmed: false,
      facilitatorConferenceName: null,
      participantConferenceName: null,
      browserRelayUsed: false,
      failureCode: prewarm.failureCode,
      facilitator: prewarm.facilitator,
      participant: prewarm.participant,
      timing: {
        ...emptyTiming(),
        browserPrewarmStartedAt: prewarm.browserPrewarmStartedAt,
        browserPrewarmCompletedAt: prewarm.browserPrewarmCompletedAt,
      },
      evidence: prewarm.evidence,
      close: prewarm.close,
    };
  }
  const now = input.nowMs ?? Date.now;
  const started = new Date(now()).toISOString();
  return prewarm.liveJoin({
    expectedConferenceName: input.expectedConferenceName,
    expiresAt: input.expiresAt ?? null,
    startConferenceStartedAt: started,
    startConferenceCompletedAt: started,
    activeRunPublishedAt: started,
    timeoutMs: input.timeoutMs,
  });
};

/**
 * Start recording via the real facilitator UI (consent + start negotiation).
 */
export async function startRecordingViaUi(params: {
  page: import("@playwright/test").Page;
  timeoutMs: number;
}): Promise<{ started: boolean; evidence: Record<string, unknown> }> {
  const evidence: Record<string, unknown> = {};
  try {
    const startBtn = params.page.getByTestId("start-negotiation-button");
    await startBtn.waitFor({ timeout: params.timeoutMs });
    await startBtn.click();

    const consent = params.page.getByTestId("recording-consent-confirm");
    if (await consent.isVisible().catch(() => false)) {
      const checkbox = params.page.getByTestId("recording-consent-checkbox");
      if (await checkbox.isVisible().catch(() => false)) {
        await checkbox.check().catch(() => {});
      }
      await consent.click();
      evidence.consentConfirmed = true;
    }

    await params.page
      .getByTestId("recording-status")
      .waitFor({ timeout: params.timeoutMs })
      .catch(() => null);

    const statusText = await params.page
      .getByTestId("recording-status")
      .textContent()
      .catch(() => null);
    evidence.recordingStatusText = statusText;

    const started = Boolean(
      statusText &&
        /record|active|starting|идёт|запись/i.test(statusText),
    );
    return { started: started || evidence.consentConfirmed === true, evidence };
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    return { started: false, evidence };
  }
}
