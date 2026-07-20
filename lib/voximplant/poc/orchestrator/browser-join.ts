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

export type BrowserJoinInput = {
  appBaseUrl: string;
  sessionId: string;
  expectedConferenceName: string;
  facilitatorRoomUrl: string;
  participantRoomUrl: string;
  facilitatorAuthCookie: string;
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
  startConferenceToFirstAccessMs: number | null;
  startConferenceToFirstJoinMs: number | null;
  startConferenceToBothJoinedMs: number | null;
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
  close: () => Promise<void>;
};

export type BrowserPrewarmInput = {
  appBaseUrl: string;
  sessionId: string;
  facilitatorRoomUrl: string;
  participantRoomUrl: string;
  facilitatorAuthCookie: string;
  timeoutMs: number;
  keepBrowser?: boolean;
  runId: string;
  stateRoot?: string;
  nowMs?: () => number;
};

export type BrowserPrewarmHandle = {
  ok: boolean;
  failureCode: BrowserFailureCode | null;
  browserPrewarmStartedAt: string;
  browserPrewarmCompletedAt: string | null;
  facilitator: BrowserContextEvidence;
  participant: BrowserContextEvidence;
  evidence: Record<string, unknown>;
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
  const evidence: Record<string, unknown> = {
    phase: "prewarm",
    appBaseUrlHost: (() => {
      try {
        return new URL(input.appBaseUrl).host;
      } catch {
        return "invalid";
      }
    })(),
    cookieName: parseCookieHeader(input.facilitatorAuthCookie).name,
    cookieBindingMode: "URL_BOUND",
    secure: (() => {
      try {
        return new URL(input.appBaseUrl).protocol === "https:";
      } catch {
        return false;
      }
    })(),
    facilitatorAuthStrategy: "AUTH_SESSION_COOKIE",
    participantAuthStrategy: "JOIN_TOKEN_URL",
    participantCookieInstalled: false,
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

    // Facilitator: authenticated auth_session via URL-bound cookie only.
    try {
      const built = buildUrlBoundAuthCookie({
        cookieHeader: input.facilitatorAuthCookie,
        appBaseUrl: input.appBaseUrl,
      });
      evidence.cookieBindingMode = built.bindingMode;
      evidence.appBaseUrlHost = built.appBaseUrlHost;
      evidence.secure = built.secure;
      evidence.cookieName = built.cookieName;
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

    // Participant: join-token URL only — never install facilitator auth_session.
    try {
      prepareParticipantJoinContext({
        participantRoomUrl: input.participantRoomUrl,
      });
      evidence.participantCookieInstalled = false;
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
        failingOperation: "prepareParticipantJoinContext",
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

    // Auth probe for facilitator (cookie) without joining conference.
    const authProbeUrl = `${input.appBaseUrl.replace(/\/$/, "")}/api/sessions/${input.sessionId}/control-state`;
    const authResp = await facilitatorContext.request.get(authProbeUrl, {
      timeout: Math.min(input.timeoutMs, 15_000),
    });
    if (authResp.status() === 401 || authResp.status() === 403) {
      return failPrewarm(
        "FACILITATOR_AUTH_FAILED",
        "facilitator",
        "AUTH_ACCEPTED",
      );
    }
    if (!authResp.ok()) {
      // control-state may require joinToken — treat 400 with cookie present as soft pass
      // if body indicates missing joinToken (session exists + cookie accepted enough to parse).
      const body = await authResp.text().catch(() => "");
      if (
        authResp.status() === 400 &&
        /joinToken|participantId/i.test(body)
      ) {
        facilitator = {
          ...facilitator,
          authAccepted: true,
          reachedStage: advanceStage(facilitator.reachedStage, "AUTH_ACCEPTED"),
        };
      } else {
        return failPrewarm(
          "FACILITATOR_AUTH_FAILED",
          "facilitator",
          "AUTH_ACCEPTED",
        );
      }
    } else {
      facilitator = {
        ...facilitator,
        authAccepted: true,
        reachedStage: advanceStage(facilitator.reachedStage, "AUTH_ACCEPTED"),
      };
    }

    // Navigate both rooms with access gated (prewarm stops before access).
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
      await Promise.all([
        facilitatorPage.goto(input.facilitatorRoomUrl, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(input.timeoutMs, 30_000),
        }),
        participantPage.goto(input.participantRoomUrl, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(input.timeoutMs, 30_000),
        }),
      ]);
    } catch (error) {
      evidence.prewarmError = redactBoundedErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      evidence.failingOperation = "page.goto";
      return failPrewarm("ROOM_PAGE_FAILED", "both", "ROOM_NAVIGATION_STARTED");
    }

    facilitator.pageUrlPath = sanitizePageUrl(facilitatorPage.url());
    participant.pageUrlPath = sanitizePageUrl(participantPage.url());

    if (/\/login/i.test(facilitator.pageUrlPath)) {
      return failPrewarm(
        "FACILITATOR_AUTH_FAILED",
        "facilitator",
        "ROOM_PAGE_LOADED",
      );
    }
    if (/\/login/i.test(participant.pageUrlPath)) {
      return failPrewarm(
        "PARTICIPANT_AUTH_FAILED",
        "participant",
        "ROOM_PAGE_LOADED",
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

    const browserPrewarmCompletedAt = new Date(nowMs()).toISOString();
    evidence.phase = "prewarm_ready";

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

        // Release both access gates concurrently.
        releaseGates.facilitator?.();
        releaseGates.participant?.();

        const runAccess = async (
          page: import("@playwright/test").Page,
          role: "facilitator" | "participant",
        ): Promise<string | null> => {
          let ctx =
            role === "facilitator" ? facilitator : participant;
          ctx = {
            ...ctx,
            accessRequested: true,
            accessRequestedAt: new Date(nowMs()).toISOString(),
            reachedStage: advanceStage(ctx.reachedStage, "ACCESS_REQUEST_SENT"),
          };
          if (role === "facilitator") {
            timing.facilitatorAccessRequestedAt = ctx.accessRequestedAt;
            facilitator = ctx;
          } else {
            timing.participantAccessRequestedAt = ctx.accessRequestedAt;
            participant = ctx;
          }

          const responsePromise = page.waitForResponse(
            (resp) =>
              resp
                .url()
                .includes(
                  `/api/sessions/${input.sessionId}/voximplant/access`,
                ),
            { timeout: live.timeoutMs },
          );

          // Reload to re-trigger access now that gate is open (page already loaded).
          await page.reload({
            waitUntil: "domcontentloaded",
            timeout: live.timeoutMs,
          });

          const response = await responsePromise;
          const json = (await response.json().catch(() => null)) as AccessJson | null;
          const status = response.status();
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
              requestPath: `/api/sessions/${input.sessionId}/voximplant/access`,
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
            },
          };

          if (status !== 200) {
            ctx = markFailed(
              ctx,
              "ACCESS_REQUEST_SUCCEEDED",
              classifyAccessHttpStatus(status),
            );
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
            runAccess(facilitatorPage!, "facilitator"),
            runAccess(participantPage!, "participant"),
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
          timing.startConferenceToFirstAccessMs =
            Math.min(...firstAccessMs) - startCompletedMs;
        }
        const firstJoinMs = [
          timing.facilitatorCallConnectedAt,
          timing.participantCallConnectedAt,
        ]
          .filter(Boolean)
          .map((v) => Date.parse(v!))
          .filter((n) => Number.isFinite(n));
        if (firstJoinMs.length && Number.isFinite(startCompletedMs)) {
          timing.startConferenceToFirstJoinMs =
            Math.min(...firstJoinMs) - startCompletedMs;
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
          timing.startConferenceToBothJoinedMs = bothAt - startCompletedMs;
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
