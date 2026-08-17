import {
  CURRENT_CONSENT_TYPES,
  consentFieldName,
  type CurrentConsentType,
} from "@/lib/consent/user-consent";
import { getCurrentLegalRelease } from "@/lib/legal/release";

export type LegalAcknowledgementLink = {
  href: string;
  labelKey:
    | "legal.termsOfUse"
    | "legal.consentPrivacyPolicyLink"
    | "legal.dataProcessingConsent"
    | "legal.aiProcessingNotice";
};

export type LegalAcknowledgementUi = {
  consentType: CurrentConsentType;
  fieldName: string;
  testId: string;
  startKey:
    | "legal.consentTermsPrivacyStart"
    | "legal.consentPersonalDataStart"
    | "legal.consentTrainingSessionStart";
  middleKey?: "legal.consentTermsPrivacyMiddle";
  endKey:
    | "legal.consentTermsPrivacyEnd"
    | "legal.consentPersonalDataEnd"
    | "legal.consentTrainingSessionEnd";
  links: LegalAcknowledgementLink[];
};

const ACKNOWLEDGEMENT_UI: Record<CurrentConsentType, LegalAcknowledgementUi> = {
  TERMS_PRIVACY_ACK_V2: {
    consentType: CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2,
    fieldName: consentFieldName(CURRENT_CONSENT_TYPES.TERMS_PRIVACY_ACK_V2),
    testId: "consent-terms-privacy",
    startKey: "legal.consentTermsPrivacyStart",
    middleKey: "legal.consentTermsPrivacyMiddle",
    endKey: "legal.consentTermsPrivacyEnd",
    links: [
      { href: "/terms", labelKey: "legal.termsOfUse" },
      { href: "/privacy", labelKey: "legal.consentPrivacyPolicyLink" },
    ],
  },
  PERSONAL_DATA_PROCESSING_V2: {
    consentType: CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2,
    fieldName: consentFieldName(
      CURRENT_CONSENT_TYPES.PERSONAL_DATA_PROCESSING_V2,
    ),
    testId: "consent-personal-data-processing",
    startKey: "legal.consentPersonalDataStart",
    endKey: "legal.consentPersonalDataEnd",
    links: [
      {
        href: "/data-processing-consent",
        labelKey: "legal.dataProcessingConsent",
      },
    ],
  },
  TRAINING_SESSION_NOTICE_V2: {
    consentType: CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2,
    fieldName: consentFieldName(
      CURRENT_CONSENT_TYPES.TRAINING_SESSION_NOTICE_V2,
    ),
    testId: "consent-training-session-notice",
    startKey: "legal.consentTrainingSessionStart",
    endKey: "legal.consentTrainingSessionEnd",
    links: [
      { href: "/ai-processing-notice", labelKey: "legal.aiProcessingNotice" },
    ],
  },
};

export function getLegalAcknowledgementUi(
  consentType: CurrentConsentType,
): LegalAcknowledgementUi {
  const ui = ACKNOWLEDGEMENT_UI[consentType];
  if (!ui) {
    throw new Error(`Missing acknowledgement UI for ${consentType}`);
  }
  return ui;
}

export function getCurrentLegalAcknowledgementUi(): LegalAcknowledgementUi[] {
  return getCurrentLegalRelease().requiredConsentTypes.map((consentType) =>
    getLegalAcknowledgementUi(consentType),
  );
}
