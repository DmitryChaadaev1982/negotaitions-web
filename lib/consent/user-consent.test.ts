import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_CONSENT_TYPES,
  LEGACY_CONSENT_TYPES,
  LEGACY_CONSENT_VERSION,
} from "@/lib/consent/user-consent";
import {
  CURRENT_CONSENT_VERSION,
  CURRENT_REGISTRATION_CONSENT_TYPES,
} from "@/lib/legal/release";

test("v2 registration consent identifiers are explicit and migration-free", () => {
  assert.equal(CURRENT_CONSENT_VERSION, "2");
  assert.equal(LEGACY_CONSENT_VERSION, "1");
  assert.deepEqual(CURRENT_REGISTRATION_CONSENT_TYPES, [
    CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2,
    CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2,
    CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2,
  ]);
  assert.equal(LEGACY_CONSENT_TYPES.TERMS_PRIVACY_V1, "TERMS_PRIVACY_V1");
  assert.equal(
    LEGACY_CONSENT_TYPES.MVP_DATA_LIMITATION_V1,
    "MVP_DATA_LIMITATION_V1",
  );
  assert.equal(
    LEGACY_CONSENT_TYPES.EXTERNAL_INFRASTRUCTURE_V1,
    "EXTERNAL_INFRASTRUCTURE_V1",
  );
});
