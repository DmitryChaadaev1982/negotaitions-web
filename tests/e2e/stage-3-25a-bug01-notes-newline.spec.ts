import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  cleanupE2eData,
  createActiveUser,
  createE2eCase,
  createUserSessionCookie,
  e2eId,
  e2eName,
  query,
} from "./helpers/db";
import { seedCookieConsent } from "./helpers/cookie-consent";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await cleanupE2eData();
});

test.afterEach(async () => {
  await cleanupE2eData();
});

const SAVED_SEED = "line1line2";
const MID_CARET_INDEX = "line1".length;

type NotesFixture = {
  sessionId: string;
  observer: { userId: string };
  participant: { userId: string };
};

async function authenticatePage(page: Page, userId: string) {
  const cookie = await createUserSessionCookie(userId);
  const url = test.info().project.use.baseURL ?? "http://127.0.0.1:3100";
  await page.context().addCookies([
    {
      name: "auth_session",
      value: cookie.replace("auth_session=", ""),
      url,
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "negotaitions_locale",
      value: "en",
      url,
    },
  ]);
  await page.addInitScript(() => {
    window.localStorage.setItem("negotaitions_locale", "en");
  });
}

async function createNotesFixture(): Promise<NotesFixture> {
  const negotiationCase = await createE2eCase();
  const facilitatorUser = await createActiveUser({ preferredLocale: "en" });
  const observerUser = await createActiveUser({ preferredLocale: "en" });
  const participantUser = await createActiveUser({ preferredLocale: "en" });
  const sessionId = e2eId("bug01-session");
  const facilitatorParticipantId = e2eId("bug01-facilitator");
  const observerParticipantId = e2eId("bug01-observer");
  const participantParticipantId = e2eId("bug01-participant");
  const sessionRoleId = e2eId("bug01-role");
  const sourceRole = negotiationCase.roles[0];
  if (!sourceRole) {
    throw new Error("E2E case roles were not created.");
  }

  await query(
    `INSERT INTO "Session"
       ("id", "title", "negotiationCaseId", "facilitatorId", "eventId", "visibility",
        "status", "snapshotCaseTitle", "snapshotBusinessContext",
        "snapshotPublicInstructions", "snapshotCaseLanguage", "negotiationState",
        "roomLifecycle", "durationSeconds", "preparationDurationSeconds",
        "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NULL, 'PRIVATE', 'READY', $5, 'Context',
        'Instructions', 'EN', 'PREPARATION', 'OPEN', 900, 300, NOW(), NOW())`,
    [
      sessionId,
      e2eName("Stage 3.25A BUG01 notes newline"),
      negotiationCase.id,
      facilitatorUser.id,
      negotiationCase.title,
    ],
  );
  await query(
    `INSERT INTO "SessionRole"
       ("id", "sessionId", "name", "privateInstructions", "objectives",
        "constraints", "hiddenInfo", "fallbackPosition", "sortOrder", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, NOW(), NOW())`,
    [
      sessionRoleId,
      sessionId,
      sourceRole.name,
      sourceRole.privateInstructions,
      sourceRole.objectives,
      sourceRole.constraints,
      sourceRole.hiddenInfo,
      sourceRole.fallbackPosition,
    ],
  );
  await query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "userId", "displayName", "type", "joinToken",
        "sessionRoleId", "notes", "createdAt", "updatedAt")
     VALUES
       ($1, $4, $5, 'Facilitator', 'FACILITATOR', $8, NULL, '', NOW(), NOW()),
       ($2, $4, $6, 'Observer', 'OBSERVER', $9, NULL, $11, NOW(), NOW()),
       ($3, $4, $7, 'Assigned player', 'PARTICIPANT', $10, $12, $11, NOW(), NOW())`,
    [
      facilitatorParticipantId,
      observerParticipantId,
      participantParticipantId,
      sessionId,
      facilitatorUser.id,
      observerUser.id,
      participantUser.id,
      e2eId("bug01-fac-token"),
      e2eId("bug01-obs-token"),
      e2eId("bug01-part-token"),
      SAVED_SEED,
      sessionRoleId,
    ],
  );

  return {
    sessionId,
    observer: { userId: observerUser.id },
    participant: { userId: participantUser.id },
  };
}

async function openRoomSidebar(page: Page, sessionId: string, userId: string) {
  await seedCookieConsent(page);
  await authenticatePage(page, userId);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/room/${sessionId}?media=off`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("session-room-header")).toBeVisible({
    timeout: 30_000,
  });
  const sidebar = page.getByTestId("room-desktop-sidebar");
  const notes = sidebar.getByTestId("participant-notes-textarea");
  await notes.scrollIntoViewIfNeeded();
  await expect(notes).toBeVisible();
  return sidebar;
}

async function insertEnterAtCaret(page: Page, notes: Locator, caretIndex: number) {
  await notes.click();
  await notes.evaluate((el, index) => {
    const node = el as HTMLTextAreaElement;
    node.focus();
    node.setSelectionRange(index, index);
  }, caretIndex);
  await page.keyboard.press("Enter");
}

async function expectSavedClean(sidebar: Locator, notes: Locator, expectedValue: string) {
  await expect(notes).toHaveValue(expectedValue);
  await expect(sidebar.getByTestId("participant-notes-saved")).toBeVisible();
  await expect(sidebar.getByTestId("participant-notes-unsaved")).toHaveCount(0);
}

async function saveMidTextEnterAndProveDirtyContract(page: Page, sidebar: Locator) {
  const notes = sidebar.getByTestId("participant-notes-textarea");
  await expect(notes).toHaveValue(SAVED_SEED);
  await insertEnterAtCaret(page, notes, MID_CARET_INDEX);
  await expect(notes).toHaveValue("line1\nline2");
  await expect(sidebar.getByTestId("participant-notes-unsaved")).toBeVisible();

  await sidebar.getByTestId("participant-notes-save-button").click();
  await expectSavedClean(sidebar, notes, "line1\nline2");

  await notes.click();
  await expectSavedClean(sidebar, notes, "line1\nline2");

  await notes.focus();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await expect(notes).toHaveValue("line1\nline2x");
  await expect(sidebar.getByTestId("participant-notes-unsaved")).toBeVisible();
  await expect(sidebar.getByTestId("participant-notes-saved")).toHaveCount(0);
}

test("Observer room notes stay saved after a mid-text Enter during negotiation @bug01-notes", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await createNotesFixture();
  await query(
    `UPDATE "Session"
       SET "negotiationState" = 'RUNNING',
           "negotiationStartedAt" = NOW() - INTERVAL '3 minutes',
           "timerStartedAt" = NOW() - INTERVAL '3 minutes',
           "updatedAt" = NOW()
     WHERE "id" = $1`,
    [fixture.sessionId],
  );

  const sidebar = await openRoomSidebar(page, fixture.sessionId, fixture.observer.userId);
  await expect(
    sidebar.getByRole("heading", { name: "Observer notes" }).first(),
  ).toBeVisible();
  await saveMidTextEnterAndProveDirtyContract(page, sidebar);
});

test("Participant room notes stay saved after a mid-text Enter during preparation @bug01-notes", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await createNotesFixture();
  const sidebar = await openRoomSidebar(
    page,
    fixture.sessionId,
    fixture.participant.userId,
  );
  await expect(
    sidebar.getByRole("heading", { name: "Preparation" }).first(),
  ).toBeVisible();
  await saveMidTextEnterAndProveDirtyContract(page, sidebar);
});
