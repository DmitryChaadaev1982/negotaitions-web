import assert from "node:assert/strict";
import test from "node:test";

import { CURRENT_CONSENT_TYPES } from "@/lib/consent/user-consent";
import { CURRENT_LEGAL_RELEASE } from "@/lib/legal/release";
import {
  emptyLegalUpdateDraft,
  legalUpdateDraftStorageKey,
  parseLegalUpdateDraft,
  serializeLegalUpdateDraft,
} from "@/lib/legal/legal-update-draft";

test("draft storage key is release-scoped and contains no user data", () => {
  assert.equal(
    legalUpdateDraftStorageKey(),
    `negotaitions.legalUpdateDraft.${CURRENT_LEGAL_RELEASE.id}`,
  );
  assert.equal(
    legalUpdateDraftStorageKey("other-release"),
    "negotaitions.legalUpdateDraft.other-release",
  );
  assert.equal(legalUpdateDraftStorageKey().includes("@"), false);
  assert.equal(legalUpdateDraftStorageKey().toLowerCase().includes("token"), false);
});

test("draft parse keeps only the three current-release booleans", () => {
  const parsed = parseLegalUpdateDraft(
    JSON.stringify({
      [CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2]: true,
      [CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2]: true,
      [CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2]: false,
      email: "user@example.com",
      token: "RAW_SECRET",
      userId: "user-1",
    }),
  );
  assert.deepEqual(parsed, {
    [CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2]: true,
    [CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2]: true,
    [CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2]: false,
  });
  const serialized = serializeLegalUpdateDraft(parsed);
  assert.equal(serialized.includes("user@example.com"), false);
  assert.equal(serialized.includes("RAW_SECRET"), false);
  assert.equal(serialized.includes("user-1"), false);
});

test("invalid draft payloads become empty booleans", () => {
  assert.deepEqual(parseLegalUpdateDraft(null), emptyLegalUpdateDraft());
  assert.deepEqual(parseLegalUpdateDraft("{not json"), emptyLegalUpdateDraft());
  assert.deepEqual(parseLegalUpdateDraft("[]"), emptyLegalUpdateDraft());
  assert.deepEqual(
    parseLegalUpdateDraft(
      JSON.stringify({
        [CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2]: "true",
      }),
    ),
    emptyLegalUpdateDraft(),
  );
});
