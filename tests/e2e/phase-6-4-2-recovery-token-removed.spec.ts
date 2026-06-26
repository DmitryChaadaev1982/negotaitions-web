/**
 * Phase 6.4.2 — Remove Legacy joinToken Recovery Storage
 *
 * Verifies that browser recovery storage never persists secret tokens and that
 * the unauthenticated /rejoin page only suggests signing in (no guest restore).
 *
 * Covered:
 *   1. saveRecoveryContext / sanitizeRecoveryContext never keep joinToken,
 *      hostToken, participantToken, or facilitatorJoinToken.
 *   2. A legacy recovery entry containing a token is detected, ignored, and
 *      cleared on read.
 *   3. /rejoin (unauthenticated) shows a sign-in suggestion, exposes no
 *      guest-restore action, and purges any stale recovery entry from
 *      localStorage.
 *
 * Pure-logic tests run with no server/DB. The browser test uses the dev server
 * that Playwright starts automatically (no DATABASE_URL required for the public
 * /rejoin page when there is no session cookie).
 */

import { test, expect } from "@playwright/test";

import {
  RECOVERY_SECRET_FIELDS,
  RECOVERY_STORAGE_KEY,
  recoveryValueHasLegacyToken,
  sanitizeRecoveryContext,
} from "../../lib/rejoin/recovery-storage";

// ── Pure storage-shape tests ─────────────────────────────────────────────────

test.describe("Phase 6.4.2 — recovery storage strips secrets", () => {
  test("sanitizeRecoveryContext drops every secret token field", () => {
    const dirty = {
      type: "SESSION_ROOM",
      sessionId: "sess_123",
      eventId: "event_123",
      joinToken: "secret-join",
      hostToken: "secret-host",
      participantToken: "secret-participant",
      facilitatorJoinToken: "secret-facilitator",
      displayName: "Should Not Persist",
      updatedAt: "2026-06-26T00:00:00.000Z",
    };

    const clean = sanitizeRecoveryContext(dirty);

    expect(clean).toEqual({
      type: "SESSION_ROOM",
      sessionId: "sess_123",
      eventId: "event_123",
      updatedAt: "2026-06-26T00:00:00.000Z",
    });

    const serialized = JSON.stringify(clean);
    for (const field of RECOVERY_SECRET_FIELDS) {
      expect(serialized).not.toContain(field);
    }
    expect(serialized).not.toContain("Should Not Persist");
  });

  test("recoveryValueHasLegacyToken detects each legacy secret", () => {
    for (const field of RECOVERY_SECRET_FIELDS) {
      const legacy = {
        type: "SESSION_ROOM",
        sessionId: "sess_123",
        updatedAt: "2026-06-26T00:00:00.000Z",
        [field]: "leaked-secret",
      };
      expect(recoveryValueHasLegacyToken(legacy)).toBe(true);
    }
  });

  test("recoveryValueHasLegacyToken is false for a clean hint entry", () => {
    const clean = {
      type: "EVENT_LOBBY",
      eventId: "event_123",
      updatedAt: "2026-06-26T00:00:00.000Z",
    };
    expect(recoveryValueHasLegacyToken(clean)).toBe(false);
  });

  test("sanitizeRecoveryContext rejects structurally invalid values", () => {
    expect(sanitizeRecoveryContext(null)).toBeNull();
    expect(sanitizeRecoveryContext({ type: "NOPE", updatedAt: "x" })).toBeNull();
    expect(sanitizeRecoveryContext({ type: "SESSION_ROOM" })).toBeNull();
  });
});

// ── Unauthenticated /rejoin behavior ─────────────────────────────────────────

test.describe("Phase 6.4.2 — unauthenticated /rejoin", () => {
  test("shows sign-in suggestion, no guest restore, and clears legacy token entry", async ({
    page,
  }) => {
    // Seed a legacy recovery entry containing a joinToken before app JS runs.
    await page.addInitScript(
      ([key]) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            type: "SESSION_ROOM",
            sessionId: "sess_legacy",
            joinToken: "legacy-secret-token",
            updatedAt: new Date().toISOString(),
          }),
        );
      },
      [RECOVERY_STORAGE_KEY],
    );

    await page.goto("/rejoin");

    // Sign-in suggestion is shown.
    await expect(page.getByTestId("rejoin-signin-message")).toBeVisible();

    // No guest-restore action exists.
    await expect(page.getByTestId("rejoin-room-button")).toHaveCount(0);
    await expect(page.getByTestId("rejoin-materials-button")).toHaveCount(0);
    await expect(page.getByTestId("rejoin-lobby-button")).toHaveCount(0);

    // The legacy token entry has been purged from localStorage.
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      RECOVERY_STORAGE_KEY,
    );
    expect(stored).toBeNull();
  });
});
