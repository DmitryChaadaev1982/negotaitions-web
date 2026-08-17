/**
 * Account consent identifiers stored on UserConsent.
 *
 * consentType is a free-form String in Prisma. New identifiers do not require
 * a schema migration. Historical v1 rows must never be rewritten.
 */

export const LEGACY_CONSENT_VERSION = "1";

export const LEGACY_CONSENT_TYPES = {
  TERMS_PRIVACY_V1: "TERMS_PRIVACY_V1",
  MVP_DATA_LIMITATION_V1: "MVP_DATA_LIMITATION_V1",
  EXTERNAL_INFRASTRUCTURE_V1: "EXTERNAL_INFRASTRUCTURE_V1",
} as const;

export const CURRENT_CONSENT_TYPES = {
  TERMS_PRIVACY_ACK_V2: "TERMS_PRIVACY_ACK_V2",
  PERSONAL_DATA_PROCESSING_V2: "PERSONAL_DATA_PROCESSING_V2",
  TRAINING_SESSION_NOTICE_V2: "TRAINING_SESSION_NOTICE_V2",
} as const;

export const CONSENT_TYPES = {
  ...LEGACY_CONSENT_TYPES,
  ...CURRENT_CONSENT_TYPES,
} as const;

export type LegacyConsentType =
  (typeof LEGACY_CONSENT_TYPES)[keyof typeof LEGACY_CONSENT_TYPES];
export type CurrentConsentType =
  (typeof CURRENT_CONSENT_TYPES)[keyof typeof CURRENT_CONSENT_TYPES];
export type ConsentType = (typeof CONSENT_TYPES)[keyof typeof CONSENT_TYPES];

export function consentFieldName(consentType: string): string {
  return `consent:${consentType}`;
}
