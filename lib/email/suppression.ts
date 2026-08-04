import {
  EmailMessageCategory,
  EmailSuppressionReason,
  EmailSuppressionSource,
  type Prisma,
} from "@/app/generated/prisma/client";
import { normalizeEmailAddress } from "@/lib/email/address";
import { prisma } from "@/lib/prisma";

const PRODUCT_OR_MARKETING = new Set<EmailMessageCategory>([
  EmailMessageCategory.PRODUCT,
  EmailMessageCategory.MARKETING,
]);

export type SuppressionDecision = {
  suppressed: boolean;
  reason?: EmailSuppressionReason;
  suppressionId?: string;
};

type EmailDbClient = typeof prisma | Prisma.TransactionClient;

export function doesSuppressionApply(
  reason: EmailSuppressionReason,
  category: EmailMessageCategory,
  scope: EmailMessageCategory | null,
): boolean {
  if (scope && scope !== category) return false;
  if (reason === EmailSuppressionReason.HARD_BOUNCE) {
    return category !== EmailMessageCategory.SECURITY;
  }
  if (reason === EmailSuppressionReason.COMPLAINT) {
    return category !== EmailMessageCategory.SECURITY;
  }
  if (reason === EmailSuppressionReason.UNSUBSCRIBE) {
    return PRODUCT_OR_MARKETING.has(category);
  }
  return true;
}

export async function evaluateSuppression(params: {
  recipientEmail: string;
  category: EmailMessageCategory;
  now?: Date;
  db?: EmailDbClient;
}): Promise<SuppressionDecision> {
  const now = params.now ?? new Date();
  const db = params.db ?? prisma;
  const normalized = normalizeEmailAddress(params.recipientEmail);
  const suppressions = await db.emailSuppression.findMany({
    where: {
      recipientEmailNormalized: normalized,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "asc" },
  });

  const matching = suppressions.find((suppression) =>
    doesSuppressionApply(
      suppression.reason,
      params.category,
      suppression.categoryScope,
    ),
  );
  if (!matching) {
    return { suppressed: false };
  }
  return {
    suppressed: true,
    reason: matching.reason,
    suppressionId: matching.id,
  };
}

export async function createActiveSuppression(params: {
  recipientEmailNormalized: string;
  reason: EmailSuppressionReason;
  source: EmailSuppressionSource;
  categoryScope?: EmailMessageCategory | null;
  metadata?: Prisma.InputJsonValue;
  db?: EmailDbClient;
}) {
  const db = params.db ?? prisma;
  const categoryScope = params.categoryScope ?? null;
  const where = {
    recipientEmailNormalized: params.recipientEmailNormalized,
    active: true,
    categoryScope,
  };

  const existing = await db.emailSuppression.findFirst({ where });
  if (existing) {
    return { suppression: existing, created: false };
  }

  try {
    const suppression = await db.emailSuppression.create({
      data: {
        recipientEmailNormalized: params.recipientEmailNormalized,
        reason: params.reason,
        source: params.source,
        categoryScope,
        metadata: params.metadata,
      },
    });
    return { suppression, created: true };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      const suppression = await db.emailSuppression.findFirst({ where });
      if (suppression) {
        return { suppression, created: false };
      }
    }
    throw error;
  }
}
