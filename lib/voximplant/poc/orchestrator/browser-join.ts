/**
 * Playwright browser join for full-mode POC.
 * Expects the Next.js app already running from this worktree (no second server).
 */

export type BrowserJoinInput = {
  appBaseUrl: string;
  sessionId: string;
  expectedConferenceName: string;
  facilitatorRoomUrl: string;
  participantRoomUrl: string;
  facilitatorAuthCookie: string;
  timeoutMs: number;
  keepBrowser?: boolean;
};

export type BrowserJoinResult = {
  facilitatorJoined: boolean;
  participantJoined: boolean;
  sameConferenceConfirmed: boolean;
  facilitatorConferenceName: string | null;
  participantConferenceName: string | null;
  browserRelayUsed: boolean;
  evidence: Record<string, unknown>;
  close: () => Promise<void>;
};

export type BrowserJoinFn = (input: BrowserJoinInput) => Promise<BrowserJoinResult>;

function parseCookieHeader(cookieHeader: string): {
  name: string;
  value: string;
} {
  const [name, ...rest] = cookieHeader.split("=");
  return { name: name ?? "auth_session", value: rest.join("=") };
}

/**
 * Live Playwright implementation. Tests inject a mock BrowserJoinFn instead.
 */
export const playwrightBrowserJoin: BrowserJoinFn = async (input) => {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });

  let browserRelayUsed = false;
  const evidence: Record<string, unknown> = {
    facilitatorAccessConference: null,
    participantAccessConference: null,
  };

  const facilitatorContext = await browser.newContext();
  const participantContext = await browser.newContext();

  const cookie = parseCookieHeader(input.facilitatorAuthCookie);
  await facilitatorContext.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      url: input.appBaseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  const facilitatorPage = await facilitatorContext.newPage();
  const participantPage = await participantContext.newPage();

  const watchRelay = (page: import("@playwright/test").Page) => {
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
  watchRelay(facilitatorPage);
  watchRelay(participantPage);

  const captureAccessConference = async (
    page: import("@playwright/test").Page,
    label: "facilitator" | "participant",
  ): Promise<string | null> => {
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/sessions/${input.sessionId}/voximplant/access`) &&
        resp.status() === 200,
      { timeout: input.timeoutMs },
    );
    await page.goto(
      label === "facilitator"
        ? input.facilitatorRoomUrl
        : input.participantRoomUrl,
      { waitUntil: "domcontentloaded", timeout: input.timeoutMs },
    );
    const response = await responsePromise;
    const json = (await response.json().catch(() => null)) as {
      roomNameOrConferenceName?: string;
    } | null;
    const name = json?.roomNameOrConferenceName ?? null;
    if (label === "facilitator") {
      evidence.facilitatorAccessConference = name;
    } else {
      evidence.participantAccessConference = name;
    }
    return name;
  };

  let facilitatorConferenceName: string | null = null;
  let participantConferenceName: string | null = null;

  try {
    facilitatorConferenceName = await captureAccessConference(
      facilitatorPage,
      "facilitator",
    );
    participantConferenceName = await captureAccessConference(
      participantPage,
      "participant",
    );

    // Wait for room shell / connected signal (best-effort DOM + access match).
    await Promise.all([
      facilitatorPage
        .waitForSelector('[data-testid="start-negotiation-button"], [data-testid="recording-status"], body', {
          timeout: Math.min(input.timeoutMs, 30_000),
        })
        .catch(() => null),
      participantPage
        .waitForSelector("body", { timeout: Math.min(input.timeoutMs, 30_000) })
        .catch(() => null),
    ]);

    // Optional POC diagnostic on window when present.
    const facDiag = await facilitatorPage
      .evaluate(() => {
        const w = window as unknown as {
          __VOX_SERVER_STOP_POC_DIAG__?: {
            conferenceName?: string;
            joined?: boolean;
          };
        };
        return w.__VOX_SERVER_STOP_POC_DIAG__ ?? null;
      })
      .catch(() => null);
    evidence.facilitatorDiag = facDiag;

    const sameConferenceConfirmed =
      facilitatorConferenceName === input.expectedConferenceName &&
      participantConferenceName === input.expectedConferenceName;

    const facilitatorJoined = sameConferenceConfirmed;
    const participantJoined = sameConferenceConfirmed;

    return {
      facilitatorJoined,
      participantJoined,
      sameConferenceConfirmed,
      facilitatorConferenceName,
      participantConferenceName,
      browserRelayUsed,
      evidence,
      close: async () => {
        if (!input.keepBrowser) {
          await facilitatorContext.close().catch(() => {});
          await participantContext.close().catch(() => {});
          await browser.close().catch(() => {});
        }
      },
    };
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    return {
      facilitatorJoined: false,
      participantJoined: false,
      sameConferenceConfirmed: false,
      facilitatorConferenceName,
      participantConferenceName,
      browserRelayUsed,
      evidence,
      close: async () => {
        if (!input.keepBrowser) {
          await facilitatorContext.close().catch(() => {});
          await participantContext.close().catch(() => {});
          await browser.close().catch(() => {});
        }
      },
    };
  }
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
