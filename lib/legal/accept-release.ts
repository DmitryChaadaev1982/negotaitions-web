import { lockUserRowForUpdate } from "@/lib/auth/user-row-lock";
import { getCurrentLegalRelease } from "@/lib/legal/release";
import { planLegalReleaseAcceptance } from "@/lib/legal/status";
import { prisma } from "@/lib/prisma";

export async function persistCurrentLegalReleaseAcceptance(params: {
  userId: string;
  now?: Date;
  ipHash?: string | null;
  userAgent?: string | null;
}): Promise<{
  insertedConsentTypes: string[];
  alreadyPresentConsentTypes: string[];
}> {
  const release = getCurrentLegalRelease();
  const now = params.now ?? new Date();
  const requiredConsentTypes = [...release.requiredConsentTypes];

  return prisma.$transaction(async (tx) => {
    const locked = await lockUserRowForUpdate(tx, params.userId);
    if (!locked) {
      throw new Error("USER_NOT_FOUND");
    }

    const existing = await tx.userConsent.findMany({
      where: {
        userId: params.userId,
        consentType: { in: requiredConsentTypes },
      },
      select: { consentType: true },
    });

    const plan = planLegalReleaseAcceptance(
      requiredConsentTypes,
      existing.map((row) => row.consentType),
    );

    if (plan.toInsert.length > 0) {
      await tx.userConsent.createMany({
        data: plan.toInsert.map((consentType) => ({
          userId: params.userId,
          consentType,
          version: release.legalVersion,
          acceptedAt: now,
          ipHash: params.ipHash ?? null,
          userAgent: params.userAgent ?? null,
        })),
      });
    }

    return {
      insertedConsentTypes: plan.toInsert,
      alreadyPresentConsentTypes: plan.alreadyPresent,
    };
  });
}
