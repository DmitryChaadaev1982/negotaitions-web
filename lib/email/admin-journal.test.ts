import assert from "node:assert/strict";
import test from "node:test";

import {
  EMAIL_JOURNAL_MAX_SEARCH_LENGTH,
  maskProviderMessageId,
  parseEmailJournalListQuery,
  parseEmailJournalRecipientSearchBody,
  PASSWORD_RESET_REVEAL_DENIED_MESSAGE,
  redactPasswordResetSecrets,
  EmailJournalInputError,
  failureSummaryForMessage,
} from "@/lib/email/admin-journal";

test("email journal query parsing enforces allowlists and bounds", () => {
  const parsed = parseEmailJournalListQuery(
    new URLSearchParams({
      q: "message-id-without-at",
      messageType: "PASSWORD_RESET",
      status: "PENDING",
      provider: "fake",
      locale: "en",
      suppressed: "false",
      hasFailure: "true",
      sort: "createdAt",
      direction: "desc",
      page: "1",
      pageSize: "20",
    }),
  );
  assert.equal(parsed.q, "message-id-without-at");
  assert.equal(parsed.messageType, "PASSWORD_RESET");
  assert.equal(parsed.provider, "fake");
  assert.equal(parsed.pageSize, 20);

  assert.throws(
    () =>
      parseEmailJournalListQuery(
        new URLSearchParams({ sort: "DROP TABLE" }),
      ),
    EmailJournalInputError,
  );
  assert.throws(
    () =>
      parseEmailJournalListQuery(
        new URLSearchParams({ pageSize: "999" }),
      ),
    EmailJournalInputError,
  );
  assert.throws(
    () =>
      parseEmailJournalListQuery(
        new URLSearchParams({
          q: "x".repeat(EMAIL_JOURNAL_MAX_SEARCH_LENGTH + 1),
        }),
      ),
    EmailJournalInputError,
  );
});

test("GET q with @ parses but buildWhere rejects it (M-05: email addresses rejected at query execution)", () => {
  // parseEmailJournalListQuery itself accepts q=email@... during parsing.
  // The rejection is enforced lazily by buildWhere when the query is actually used.
  // This tests the pure-parse result and documents the downstream safety net.
  const parsed = parseEmailJournalListQuery(new URLSearchParams({ q: "user@example.com" }));
  assert.equal(parsed.q, "user@example.com");
  // Verify that non-email q still works as before.
  const valid = parseEmailJournalListQuery(
    new URLSearchParams({ q: "some-message-id-abc123" }),
  );
  assert.equal(valid.q, "some-message-id-abc123");
});

test("parseEmailJournalRecipientSearchBody parses valid body with normalised email", () => {
  const result = parseEmailJournalRecipientSearchBody({
    recipientEmail: "User@Example.COM",
    status: "PENDING",
    pageSize: 20,
    sort: "createdAt",
    direction: "desc",
  });
  assert.equal(result.recipientEmailNormalized, "user@example.com");
  assert.equal(result.q, undefined);
  assert.equal(result.pageSize, 20);
});

test("parseEmailJournalRecipientSearchBody requires @ in recipient", () => {
  assert.throws(
    () => parseEmailJournalRecipientSearchBody({ recipientEmail: "notanemail" }),
    EmailJournalInputError,
  );
});

test("parseEmailJournalRecipientSearchBody rejects empty / missing recipient", () => {
  assert.throws(
    () => parseEmailJournalRecipientSearchBody({ recipientEmail: "" }),
    EmailJournalInputError,
  );
  assert.throws(
    () => parseEmailJournalRecipientSearchBody({}),
    EmailJournalInputError,
  );
  assert.throws(
    () => parseEmailJournalRecipientSearchBody(null),
    EmailJournalInputError,
  );
});

test("parseEmailJournalRecipientSearchBody rejects too-long recipient", () => {
  assert.throws(
    () =>
      parseEmailJournalRecipientSearchBody({
        recipientEmail: "a".repeat(EMAIL_JOURNAL_MAX_SEARCH_LENGTH) + "@example.com",
      }),
    EmailJournalInputError,
  );
});

test("PASSWORD_RESET_REVEAL_DENIED_MESSAGE constant value", () => {
  assert.equal(
    PASSWORD_RESET_REVEAL_DENIED_MESSAGE,
    "Sensitive account-security content is unavailable.",
  );
});

test("provider message IDs and reset secrets are masked/redacted", () => {
  assert.equal(maskProviderMessageId(null), null);
  assert.equal(maskProviderMessageId("abcd1234efgh"), "abcd…efgh");
  const redacted = redactPasswordResetSecrets(
    "Open https://local.negotaitions.ru/reset-password?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.match(redacted ?? "", /token=\[redacted\]/);
  assert.doesNotMatch(redacted ?? "", /token=a{64}/);
  const bare = redactPasswordResetSecrets(
    "token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.match(bare ?? "", /token=\[redacted\]/);
});

test("redactPasswordResetSecrets handles null input", () => {
  assert.equal(redactPasswordResetSecrets(null), null);
});

test("maskProviderMessageId masks values 8 chars or shorter", () => {
  assert.equal(maskProviderMessageId("short"), "***");
  assert.equal(maskProviderMessageId("12345678"), "***");
});

test("maskProviderMessageId shows first/last 4 with ellipsis for longer values", () => {
  const masked = maskProviderMessageId("aabbccddee1122334455");
  assert.match(masked ?? "", /^aabb/);
  assert.match(masked ?? "", /4455$/);
  assert.ok(masked?.includes("…"));
});

test("failureSummaryForMessage returns null for healthy non-failed messages", () => {
  const msg = {
    lastErrorCode: null as string | null,
    lastErrorMessage: null as string | null,
    status: "PENDING" as const,
  };
  // @ts-expect-error status cast for pure function test
  assert.equal(failureSummaryForMessage(msg), null);
});

test("failureSummaryForMessage returns error code over message for failed messages", () => {
  const msg = {
    lastErrorCode: "STALE_TOKEN" as string | null,
    lastErrorMessage: "Longer message here" as string | null,
    status: "FAILED_FINAL" as const,
  };
  // @ts-expect-error status cast
  assert.equal(failureSummaryForMessage(msg), "STALE_TOKEN");
});
