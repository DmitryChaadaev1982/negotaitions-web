/**
 * Stage 3.25A BUG03 — same-user Event Lobby takeover regression.
 *
 * Two independent browser contexts, same application user. Provider transport is
 * the existing mock `healthy-media` seam (fake camera/microphone). This is
 * takeover UI acceptance, not join/Connected forensic.
 *
 * Requires PLAYWRIGHT_VIDEO_PROVIDER=voximplant so the Event lobby mounts the
 * Vox room rather than LiveKit.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  cleanupE2eData,
  createTestEvent,
  createUserSessionCookie,
  getEventParticipants,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

async function authenticate(page: Page, userId: string) {
  const cookie = await createUserSessionCookie(userId);
  await page.context().addCookies([
    {
      name: "auth_session",
      value: cookie.slice("auth_session=".length),
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function setVoxProviderFault(page: Page, mode: "healthy-media") {
  const response = await page.request.post("/api/test/vox-provider-fault", {
    data: { mode },
  });
  expect(response.ok()).toBeTruthy();
}

test("same-user second context becomes lobby owner; first context becomes stale", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.PLAYWRIGHT_VIDEO_PROVIDER !== "voximplant",
    "BUG03 takeover regression needs PLAYWRIGHT_VIDEO_PROVIDER=voximplant",
  );

  const event = await createTestEvent({
    withParticipants: true,
    title: "Stage 3.25A BUG03 lobby takeover",
  });
  const participants = await getEventParticipants(event.id);
  const owner = participants.find((participant) => participant.displayName === "Dmitry");
  expect(owner?.userId).toBeTruthy();

  await page.context().grantPermissions(["camera", "microphone"]);
  await authenticate(page, owner!.userId!);
  await setVoxProviderFault(page, "healthy-media");

  await page.goto(`/events/${event.id}/lobby`);
  await expect(page.getByTestId("event-lobby-page")).toBeVisible();
  const roomA = page.getByTestId("event-lobby-voximplant-room");
  await expect(roomA).toBeVisible({ timeout: 20_000 });
  await expect(roomA).toHaveAttribute("data-joined", "true");
  await expect(page.getByTestId("vox-lobby-mic-toggle")).toBeEnabled();
  await expect(page.getByTestId("vox-lobby-camera-toggle")).toBeVisible();
  await expect(page.getByTestId("event-lobby-stale-connection-banner")).toHaveCount(0);

  const contextB = await browser.newContext({
    baseURL: test.info().project.use.baseURL as string | undefined,
    permissions: ["camera", "microphone"],
  });
  const pageB = await contextB.newPage();
  try {
    await authenticate(pageB, owner!.userId!);
    await pageB.goto(`/events/${event.id}/lobby`);
    await expect(pageB.getByTestId("event-lobby-page")).toBeVisible();
    const roomB = pageB.getByTestId("event-lobby-voximplant-room");
    await expect(roomB).toBeVisible({ timeout: 20_000 });
    await expect(roomB).toHaveAttribute("data-joined", "true");
    await expect(pageB.getByTestId("vox-lobby-mic-toggle")).toBeEnabled();
    await expect(pageB.getByTestId("vox-lobby-camera-toggle")).toBeVisible();
    await expect(pageB.getByTestId("event-lobby-stale-connection-banner")).toHaveCount(0);
    await expect(pageB.getByTestId("event-lobby-vox-empty-grid")).toHaveCount(0);

    await expect(page.getByTestId("event-lobby-stale-connection-banner")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("event-lobby-voximplant-room")).toHaveCount(0);
  } finally {
    await contextB.close();
  }
});
