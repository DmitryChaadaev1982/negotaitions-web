import { prisma } from "@/lib/prisma";

import {
  getCurrentLegalRelease,
  type LegalRelease,
} from "@/lib/legal/release";

export type LegalReleaseStatus = {
  release: LegalRelease;
  requiredConsentTypes: readonly string[];
  satisfiedConsentTypes: string[];
  missingConsentTypes: string[];
  actionRequired: boolean;
};

/**
 * Pure status computation. Compliance is derived only from recorded
 * acknowledgement/consent types for the given release, never from
 * user.createdAt or a hardcoded "v2" branch.
 */
export function evaluateLegalReleaseStatus(
  release: LegalRelease,
  recordedConsentTypes: readonly string[],
): LegalReleaseStatus {
  const recorded = new Set(recordedConsentTypes);
  const satisfiedConsentTypes = release.requiredConsentTypes.filter((type) =>
    recorded.has(type),
  );
  const missingConsentTypes = release.requiredConsentTypes.filter(
    (type) => !recorded.has(type),
  );
  return {
    release,
    requiredConsentTypes: release.requiredConsentTypes,
    satisfiedConsentTypes,
    missingConsentTypes,
    actionRequired:
      release.requiresExistingUserAction && missingConsentTypes.length > 0,
  };
}

export function planLegalReleaseAcceptance(
  requiredConsentTypes: readonly string[],
  existingConsentTypes: readonly string[],
): {
  toInsert: string[];
  alreadyPresent: string[];
} {
  const existing = new Set(existingConsentTypes);
  const alreadyPresent = requiredConsentTypes.filter((type) =>
    existing.has(type),
  );
  const toInsert = requiredConsentTypes.filter((type) => !existing.has(type));
  return { toInsert, alreadyPresent };
}

export async function getUserLegalReleaseStatus(
  userId: string,
  release: LegalRelease = getCurrentLegalRelease(),
): Promise<LegalReleaseStatus> {
  const rows = await prisma.userConsent.findMany({
    where: { userId },
    select: { consentType: true },
  });
  return evaluateLegalReleaseStatus(
    release,
    rows.map((row) => row.consentType),
  );
}
