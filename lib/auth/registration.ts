import { getCurrentLegalRelease } from "@/lib/legal/release";
import { prisma } from "@/lib/prisma";

export async function createRegisteredUserWithConsents(params: {
  email: string;
  name: string;
  passwordHash: string;
  globalRole: "ADMIN" | "USER";
  status: "ACTIVE" | "PENDING_APPROVAL";
  preferredLocale: "ru" | "en";
  now: Date;
  ipHash?: string | null;
  userAgent?: string | null;
}) {
  const release = getCurrentLegalRelease();

  return prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: params.email,
        name: params.name,
        passwordHash: params.passwordHash,
        globalRole: params.globalRole,
        status: params.status,
        preferredLocale: params.preferredLocale,
        lastLoginAt: params.now,
        ...(params.status === "ACTIVE" ? { approvedAt: params.now } : {}),
      },
    });

    await tx.userConsent.createMany({
      data: release.requiredConsentTypes.map((consentType) => ({
        userId: created.id,
        consentType,
        version: release.legalVersion,
        acceptedAt: params.now,
        ipHash: params.ipHash ?? null,
        userAgent: params.userAgent ?? null,
      })),
    });

    return created;
  });
}
