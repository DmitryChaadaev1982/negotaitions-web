import {
  EmailMessageCategory,
  EmailSuppressionReason,
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
}): Promise<SuppressionDecision> {
  const now = params.now ?? new Date();
  const normalized = normalizeEmailAddress(params.recipientEmail);
  const suppressions = await prisma.emailSuppression.findMany({
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
