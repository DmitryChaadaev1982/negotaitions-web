import assert from "node:assert/strict";
import test from "node:test";

import {
  EMAIL_JOURNAL_MAX_SEARCH_LENGTH,
  maskProviderMessageId,
  parseEmailJournalListQuery,
  redactPasswordResetSecrets,
  EmailJournalInputError,
} from "@/lib/email/admin-journal";

test("email journal query parsing enforces allowlists and bounds", () => {
  const parsed = parseEmailJournalListQuery(
    new URLSearchParams({
      q: "user@example.com",
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
  assert.equal(parsed.q, "user@example.com");
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
