import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_CONSENT_TYPES,
  LEGACY_CONSENT_TYPES,
  LEGACY_CONSENT_VERSION,
  consentFieldName,
} from "@/lib/consent/user-consent";
import {
  CURRENT_CONSENT_VERSION,
  CURRENT_LEGAL_RELEASE,
  CURRENT_REGISTRATION_CONSENT_TYPES,
  getCurrentLegalRelease,
} from "@/lib/legal/release";
import {
  evaluateLegalReleaseStatus,
  planLegalReleaseAcceptance,
} from "@/lib/legal/status";

const v1Only = [
  LEGACY_CONSENT_TYPES.TERMS_PRIVACY_V1,
  LEGACY_CONSENT_TYPES.MVP_DATA_LIMITATION_V1,
  LEGACY_CONSENT_TYPES.EXTERNAL_INFRASTRUCTURE_V1,
];

test("current legal release is version-driven and not hardcoded as a v2 branch", () => {
  const release = getCurrentLegalRelease();
  assert.equal(release.id, "2026-08-v2");
  assert.equal(release.legalVersion, "2");
  assert.equal(CURRENT_CONSENT_VERSION, "2");
  assert.equal(LEGACY_CONSENT_VERSION, "1");
  assert.equal(release.requiresExistingUserAction, true);
  assert.deepEqual(release.requiredConsentTypes, [
    CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2,
    CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2,
    CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2,
  ]);
  assert.equal(
    CURRENT_REGISTRATION_CONSENT_TYPES,
    CURRENT_LEGAL_RELEASE.requiredConsentTypes,
  );
  assert.equal(
    consentFieldName(CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2),
    "consent:PERSONAL_DATA_PROCESSING_V2",
  );
});

test("v1-only records do not satisfy the current release", () => {
  const status = evaluateLegalReleaseStatus(CURRENT_LEGAL_RELEASE, v1Only);
  assert.equal(status.actionRequired, true);
  assert.deepEqual(status.satisfiedConsentTypes, []);
  assert.deepEqual(
    status.missingConsentTypes,
    [...CURRENT_LEGAL_RELEASE.requiredConsentTypes],
  );
});

test("user with all current records does not require action", () => {
  const status = evaluateLegalReleaseStatus(
    CURRENT_LEGAL_RELEASE,
    CURRENT_LEGAL_RELEASE.requiredConsentTypes,
  );
  assert.equal(status.actionRequired, false);
  assert.deepEqual(
    status.missingConsentTypes,
    [],
  );
});

test("user missing one current requirement requires action", () => {
  const status = evaluateLegalReleaseStatus(CURRENT_LEGAL_RELEASE, [
    CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2,
    CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2,
  ]);
  assert.equal(status.actionRequired, true);
  assert.deepEqual(status.missingConsentTypes, [
    CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2,
  ]);
});

test("requiresExistingUserAction=false does not block an existing user", () => {
  const status = evaluateLegalReleaseStatus(
    {
      ...CURRENT_LEGAL_RELEASE,
      requiresExistingUserAction: false,
    },
    v1Only,
  );
  assert.equal(status.actionRequired, false);
  assert.deepEqual(
    status.missingConsentTypes,
    [...CURRENT_LEGAL_RELEASE.requiredConsentTypes],
  );
});

test("historical v1 rows are irrelevant to satisfying the current release", () => {
  const status = evaluateLegalReleaseStatus(CURRENT_LEGAL_RELEASE, [
    ...v1Only,
    CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2,
    CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2,
    CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2,
  ]);
  assert.equal(status.actionRequired, false);
  assert.deepEqual(status.satisfiedConsentTypes, [
    ...CURRENT_LEGAL_RELEASE.requiredConsentTypes,
  ]);
});

test("duplicate acceptance is idempotent and does not insert again", () => {
  const first = planLegalReleaseAcceptance(
    CURRENT_LEGAL_RELEASE.requiredConsentTypes,
    [],
  );
  assert.deepEqual(first.toInsert, [...CURRENT_LEGAL_RELEASE.requiredConsentTypes]);
  assert.deepEqual(first.alreadyPresent, []);

  const second = planLegalReleaseAcceptance(
    CURRENT_LEGAL_RELEASE.requiredConsentTypes,
    first.toInsert,
  );
  assert.deepEqual(second.toInsert, []);
  assert.deepEqual(second.alreadyPresent, [
    ...CURRENT_LEGAL_RELEASE.requiredConsentTypes,
  ]);
});

test("registration uses the current legal release requirements", () => {
  assert.deepEqual(
    CURRENT_REGISTRATION_CONSENT_TYPES,
    getCurrentLegalRelease().requiredConsentTypes,
  );
});
