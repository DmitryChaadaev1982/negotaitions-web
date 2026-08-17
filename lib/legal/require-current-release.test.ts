import assert from "node:assert/strict";
import test from "node:test";

import { CURRENT_LEGAL_RELEASE, LEGAL_UPDATE_PATH } from "@/lib/legal/release";
import {
  buildLegalUpdateRedirectPath,
  isCredentialBearingReturnUrl,
  sanitizeLegalUpdateReturnUrl,
} from "@/lib/legal/legal-update-return-url";
import { evaluateLegalReleaseStatus } from "@/lib/legal/status";

test("safe non-secret destinations survive for post-consent return", () => {
  assert.equal(sanitizeLegalUpdateReturnUrl("/dashboard"), "/dashboard");
  assert.equal(sanitizeLegalUpdateReturnUrl("/cases"), "/cases");
  assert.equal(
    sanitizeLegalUpdateReturnUrl("/sessions/abc-123/materials"),
    "/sessions/abc-123/materials",
  );
  assert.equal(
    sanitizeLegalUpdateReturnUrl("/room/session-1"),
    "/room/session-1",
  );
  assert.equal(
    sanitizeLegalUpdateReturnUrl("/events/event-1/lobby"),
    "/events/event-1/lobby",
  );
  assert.equal(
    sanitizeLegalUpdateReturnUrl("/events/event-1/join"),
    "/events/event-1/join",
  );
  assert.equal(sanitizeLegalUpdateReturnUrl("/rejoin"), "/rejoin");
});

test("raw join, host, and participant tokens are not accepted as legal-update return URLs", () => {
  const joinToken = "RAW_JOIN_TOKEN_SECRET";
  const hostToken = "RAW_HOST_TOKEN_SECRET";
  const participantToken = "RAW_PARTICIPANT_TOKEN_SECRET";
  const publicJoinCode = "RAW_PUBLIC_JOIN_CODE";

  const rejected = [
    `/join/${joinToken}`,
    `/join/${joinToken}?next=1`,
    `/room/session-1?joinToken=${joinToken}`,
    `/events/event-1/lobby?hostToken=${hostToken}`,
    `/events/event-1/lobby?participantToken=${participantToken}`,
    `/events/event-1/lobby?hostToken=${hostToken}&participantToken=${participantToken}`,
    `/events/join/${publicJoinCode}`,
  ];

  for (const value of rejected) {
    assert.equal(isCredentialBearingReturnUrl(value), true, value);
    assert.equal(sanitizeLegalUpdateReturnUrl(value), null, value);
    assert.equal(buildLegalUpdateRedirectPath(value), LEGAL_UPDATE_PATH, value);
    assert.equal(
      buildLegalUpdateRedirectPath(value).includes(joinToken),
      false,
      value,
    );
    assert.equal(
      buildLegalUpdateRedirectPath(value).includes(hostToken),
      false,
      value,
    );
    assert.equal(
      buildLegalUpdateRedirectPath(value).includes(participantToken),
      false,
      value,
    );
  }
});

test("legal-update redirect path never embeds raw credentials", () => {
  const joinToken = "RAW_JOIN_TOKEN_SECRET";
  const href = buildLegalUpdateRedirectPath(`/join/${joinToken}`);
  assert.equal(href, LEGAL_UPDATE_PATH);
  assert.equal(href.includes("returnUrl"), false);
  assert.equal(href.includes(joinToken), false);

  const safe = buildLegalUpdateRedirectPath("/events/event-1/lobby");
  assert.equal(
    safe,
    `${LEGAL_UPDATE_PATH}?returnUrl=${encodeURIComponent("/events/event-1/lobby")}`,
  );
  assert.equal(safe.includes("hostToken"), false);
  assert.equal(safe.includes("participantToken"), false);
});

test("nested join token in returnUrl query is not accepted", () => {
  const joinToken = "RAW_JOIN_TOKEN_SECRET";
  const nested = `/login?returnUrl=${encodeURIComponent(`/join/${joinToken}`)}`;
  assert.equal(isCredentialBearingReturnUrl(nested), true);
  assert.equal(sanitizeLegalUpdateReturnUrl(nested), null);
  assert.equal(buildLegalUpdateRedirectPath(nested).includes(joinToken), false);
});

test("external and malformed return URLs are discarded", () => {
  assert.equal(sanitizeLegalUpdateReturnUrl("https://evil.example"), null);
  assert.equal(sanitizeLegalUpdateReturnUrl("//evil.example"), null);
  assert.equal(sanitizeLegalUpdateReturnUrl(LEGAL_UPDATE_PATH), null);
  assert.equal(buildLegalUpdateRedirectPath("https://evil.example"), LEGAL_UPDATE_PATH);
});

test("non-blocking current release does not require an existing-user entry gate", () => {
  const status = evaluateLegalReleaseStatus(
    {
      ...CURRENT_LEGAL_RELEASE,
      requiresExistingUserAction: false,
    },
    [],
  );
  assert.equal(status.actionRequired, false);
});
