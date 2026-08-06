import { randomUUID } from "node:crypto";

import {
  EmailMessageCategory,
  EmailSuppressionReason,
  EmailSuppressionSource,
  type EmailSuppression,
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

  if (categoryScope === null) {
    const metadataJson =
      params.metadata === undefined ? null : JSON.stringify(params.metadata);
    const rows = await db.$queryRaw<Array<EmailSuppression & { created: boolean }>>`
      INSERT INTO "EmailSuppression" (
        "id",
        "recipientEmailNormalized",
        "reason",
        "source",
        "categoryScope",
        "active",
        "metadata",
        "createdAt"
      )
      VALUES (
        ${randomUUID()},
        ${params.recipientEmailNormalized},
        ${params.reason}::"EmailSuppressionReason",
        ${params.source}::"EmailSuppressionSource",
        NULL,
        true,
        ${metadataJson}::jsonb,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("recipientEmailNormalized")
        WHERE "active" = true AND "categoryScope" IS NULL
      DO UPDATE SET
        "reason" = CASE
          WHEN "EmailSuppression"."reason" = 'HARD_BOUNCE'
           AND EXCLUDED."reason" = 'COMPLAINT'
          THEN EXCLUDED."reason"
          ELSE "EmailSuppression"."reason"
        END,
        "source" = CASE
          WHEN "EmailSuppression"."reason" = 'HARD_BOUNCE'
           AND EXCLUDED."reason" = 'COMPLAINT'
          THEN EXCLUDED."source"
          ELSE "EmailSuppression"."source"
        END,
        "metadata" = CASE
          WHEN "EmailSuppression"."reason" = 'HARD_BOUNCE'
           AND EXCLUDED."reason" = 'COMPLAINT'
          THEN EXCLUDED."metadata"
          ELSE "EmailSuppression"."metadata"
        END
      RETURNING "EmailSuppression".*, (xmax = 0) AS "created"
    `;
    const suppression = rows[0];
    if (!suppression) {
      throw new Error("Active suppression reconciliation returned no row.");
    }
    return {
      suppression,
      created: suppression.created,
    };
  }

  async function upgradeProviderSuppression() {
    if (params.reason !== EmailSuppressionReason.COMPLAINT) return null;

    const upgraded = await db.emailSuppression.updateMany({
      where: {
        ...where,
        reason: EmailSuppressionReason.HARD_BOUNCE,
      },
      data: {
        reason: EmailSuppressionReason.COMPLAINT,
        source: params.source,
        metadata: params.metadata,
      },
    });
    if (upgraded.count === 0) return null;
    return db.emailSuppression.findFirstOrThrow({ where });
  }

  // Provider evidence has deterministic precedence. The conditional update is
  // atomic, so concurrent complaint/bounce processing cannot downgrade a
  // complaint or leave a hard bounce after a complaint commits.
  const upgraded = await upgradeProviderSuppression();
  if (upgraded) {
    return { suppression: upgraded, created: false };
  }

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
      // A concurrent insert may have won after the first upgrade attempt.
      // Re-run the precedence update before accepting the winning row.
      const concurrentlyUpgraded = await upgradeProviderSuppression();
      if (concurrentlyUpgraded) {
        return { suppression: concurrentlyUpgraded, created: false };
      }
      const suppression = await db.emailSuppression.findFirst({ where });
      if (suppression) {
        return { suppression, created: false };
      }
    }
    throw error;
  }
}
