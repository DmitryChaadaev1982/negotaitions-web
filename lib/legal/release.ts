import {
  CURRENT_CONSENT_TYPES,
  type CurrentConsentType,
} from "@/lib/consent/user-consent";

export const LEGAL_UPDATE_PATH = "/legal-update";

export type LegalRelease = {
  id: string;
  legalVersion: string;
  effectiveDate: string;
  requiresExistingUserAction: boolean;
  requiredConsentTypes: readonly CurrentConsentType[];
};

/**
 * Current published legal release. Future material or non-blocking releases
 * replace this configuration; do not scatter version checks through UI.
 */
export const CURRENT_LEGAL_RELEASE: LegalRelease = {
  id: "2026-08-v2",
  legalVersion: "2",
  effectiveDate: "2026-08-17",
  requiresExistingUserAction: true,
  requiredConsentTypes: [
    CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2,
    CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2,
    CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2,
  ],
};

export function getCurrentLegalRelease(): LegalRelease {
  return CURRENT_LEGAL_RELEASE;
}

export const CURRENT_REGISTRATION_CONSENT_TYPES: readonly CurrentConsentType[] =
  CURRENT_LEGAL_RELEASE.requiredConsentTypes;

export const CURRENT_CONSENT_VERSION = CURRENT_LEGAL_RELEASE.legalVersion;
