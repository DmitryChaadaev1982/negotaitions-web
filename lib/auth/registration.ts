import { CONSENT_TYPES } from "@/lib/consent/cookie-consent";
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
      data: [
        {
          userId: created.id,
          consentType: CONSENT_TYPES.TERMS_PRIVACY_V1,
          version: "1",
          acceptedAt: params.now,
          ipHash: params.ipHash ?? null,
          userAgent: params.userAgent ?? null,
        },
        {
          userId: created.id,
          consentType: CONSENT_TYPES.MVP_DATA_LIMITATION_V1,
          version: "1",
          acceptedAt: params.now,
          ipHash: params.ipHash ?? null,
          userAgent: params.userAgent ?? null,
        },
        {
          userId: created.id,
          consentType: CONSENT_TYPES.EXTERNAL_INFRASTRUCTURE_V1,
          version: "1",
          acceptedAt: params.now,
          ipHash: params.ipHash ?? null,
          userAgent: params.userAgent ?? null,
        },
      ],
    });

    return created;
  });
}
