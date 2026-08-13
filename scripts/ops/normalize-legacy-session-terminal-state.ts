import { Prisma, RoomLifecycle, SessionStatus } from "@/app/generated/prisma/client";
import {
  assertLegacyTerminalExpectedCounts,
  LEGACY_TERMINAL_REPAIR_FIELDS,
  parseLegacyTerminalNormalizationCli,
} from "@/lib/legacy-session-terminal-normalization";
import { bootstrapOperationalEnv } from "@/lib/operational-env";

bootstrapOperationalEnv();

const CANDIDATE_SELECT = {
  id: true,
  status: true,
  negotiationState: true,
  roomLifecycle: true,
  negotiationEndedAt: true,
  endedAt: true,
  closeReason: true,
  closedByEventAt: true,
  closedByEventId: true,
  eventId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function serializeSession<T extends object>(
  session: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(session).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

async function main() {
  const cli = parseLegacyTerminalNormalizationCli(process.argv.slice(2));
  const { prisma } = await import("@/lib/prisma");

  try {
    const categoryAWhere = {
      negotiationState: "FINISHED" as const,
      roomLifecycle: RoomLifecycle.CLOSED,
      status: { not: SessionStatus.COMPLETED },
      deletedAt: null,
    };
    const categoryBWhere = {
      negotiationState: "FINISHED" as const,
      roomLifecycle: null,
      negotiationEndedAt: { not: null },
      deletedAt: null,
    };

    const [categoryA, categoryB] = await Promise.all([
      prisma.session.findMany({
        where: categoryAWhere,
        orderBy: { id: "asc" },
        select: CANDIDATE_SELECT,
      }),
      prisma.session.findMany({
        where: categoryBWhere,
        orderBy: { id: "asc" },
        select: CANDIDATE_SELECT,
      }),
    ]);

    const baseOutput = {
      ok: true,
      mode: cli.apply ? "APPLY" : "DRY_RUN",
      invariant: {
        categoryA:
          "FINISHED + CLOSED is already terminal room authority; synchronize coarse status only.",
        categoryB:
          "Authoritative modern finish paths persist OPEN as a recovery fence or DEBRIEF_OPEN/CLOSED; FINISHED + NULL + negotiationEndedAt is legacy terminal history and effective room access is already CLOSED.",
        historicalTimestamps:
          "endedAt and updatedAt are preserved; negotiationEndedAt is evidence, not a replacement timestamp.",
        cutoffApplied: false,
      },
      writeFields: LEGACY_TERMINAL_REPAIR_FIELDS,
      candidateCounts: {
        categoryA: categoryA.length,
        categoryB: categoryB.length,
      },
      sampleLimit: cli.sampleLimit,
      samples: {
        categoryA: categoryA
          .slice(0, cli.sampleLimit)
          .map((row) => serializeSession(row)),
        categoryB: categoryB
          .slice(0, cli.sampleLimit)
          .map((row) => serializeSession(row)),
      },
    };

    if (!cli.apply) {
      console.log(JSON.stringify(baseOutput, null, 2));
      return;
    }

    if (
      cli.expectedCategoryA === null ||
      cli.expectedCategoryB === null
    ) {
      throw new Error("Expected candidate counts are required in apply mode.");
    }
    assertLegacyTerminalExpectedCounts({
      actualCategoryA: categoryA.length,
      actualCategoryB: categoryB.length,
      expectedCategoryA: cli.expectedCategoryA,
      expectedCategoryB: cli.expectedCategoryB,
    });

    const applyStartedAt = new Date();
    const transactionResult = await prisma.$transaction(
      async (tx) => {
        const [lockedCategoryA, lockedCategoryB] = await Promise.all([
          tx.session.findMany({
            where: categoryAWhere,
            orderBy: { id: "asc" },
            select: CANDIDATE_SELECT,
          }),
          tx.session.findMany({
            where: categoryBWhere,
            orderBy: { id: "asc" },
            select: CANDIDATE_SELECT,
          }),
        ]);
        assertLegacyTerminalExpectedCounts({
          actualCategoryA: lockedCategoryA.length,
          actualCategoryB: lockedCategoryB.length,
          expectedCategoryA: cli.expectedCategoryA!,
          expectedCategoryB: cli.expectedCategoryB!,
        });

        const categoryAIds = lockedCategoryA.map((row) => row.id);
        const categoryBIds = lockedCategoryB.map((row) => row.id);
        const updatedCategoryA =
          categoryAIds.length === 0
            ? 0
            : await tx.$executeRaw(Prisma.sql`
                UPDATE "Session"
                SET "status" = ${SessionStatus.COMPLETED}
                WHERE id IN (${Prisma.join(categoryAIds)})
                  AND "negotiationState" = 'FINISHED'
                  AND "roomLifecycle" = ${RoomLifecycle.CLOSED}
                  AND "status" <> ${SessionStatus.COMPLETED}
                  AND "deletedAt" IS NULL
              `);
        const updatedCategoryB =
          categoryBIds.length === 0
            ? 0
            : await tx.$executeRaw(Prisma.sql`
                UPDATE "Session"
                SET "status" = ${SessionStatus.COMPLETED},
                    "roomLifecycle" = ${RoomLifecycle.CLOSED}
                WHERE id IN (${Prisma.join(categoryBIds)})
                  AND "negotiationState" = 'FINISHED'
                  AND "roomLifecycle" IS NULL
                  AND "negotiationEndedAt" IS NOT NULL
                  AND "deletedAt" IS NULL
              `);

        if (
          updatedCategoryA !== lockedCategoryA.length ||
          updatedCategoryB !== lockedCategoryB.length
        ) {
          throw new Error(
            `Atomic update mismatch: A=${updatedCategoryA}/${lockedCategoryA.length}, B=${updatedCategoryB}/${lockedCategoryB.length}.`,
          );
        }

        const changedIds = [...categoryAIds, ...categoryBIds];
        const normalized =
          changedIds.length === 0
            ? []
            : await tx.session.findMany({
                where: { id: { in: changedIds } },
                orderBy: { id: "asc" },
                select: CANDIDATE_SELECT,
              });
        if (
          normalized.length !== changedIds.length ||
          normalized.some(
            (row) =>
              row.deletedAt !== null ||
              row.negotiationState !== "FINISHED" ||
              row.roomLifecycle !== RoomLifecycle.CLOSED ||
              row.status !== SessionStatus.COMPLETED,
          )
        ) {
          throw new Error("Post-update terminal invariant verification failed.");
        }

        const normalizedById = new Map(
          normalized.map((row) => [row.id, row]),
        );
        const beforeById = new Map(
          [...lockedCategoryA, ...lockedCategoryB].map((row) => [row.id, row]),
        );
        const historicalMetadataChanged = normalized.some((row) => {
          const before = beforeById.get(row.id);
          return (
            !before ||
            row.negotiationEndedAt?.getTime() !==
              before.negotiationEndedAt?.getTime() ||
            row.endedAt?.getTime() !== before.endedAt?.getTime() ||
            row.updatedAt.getTime() !== before.updatedAt.getTime() ||
            row.closeReason !== before.closeReason ||
            row.closedByEventAt?.getTime() !==
              before.closedByEventAt?.getTime() ||
            row.closedByEventId !== before.closedByEventId ||
            row.eventId !== before.eventId ||
            row.createdAt.getTime() !== before.createdAt.getTime()
          );
        });
        if (historicalMetadataChanged) {
          throw new Error(
            "Post-update verification detected a historical metadata change.",
          );
        }

        return {
          updatedCategoryA,
          updatedCategoryB,
          changes: [
            ...lockedCategoryA.map((before) => ({
              category: "CATEGORY_A_CLOSED_STALE_STATUS",
              id: before.id,
              before: serializeSession(before),
              after: serializeSession(normalizedById.get(before.id) ?? {}),
            })),
            ...lockedCategoryB.map((before) => ({
              category: "CATEGORY_B_FINISHED_NULL_LIFECYCLE",
              id: before.id,
              before: serializeSession(before),
              after: serializeSession(normalizedById.get(before.id) ?? {}),
            })),
          ],
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30_000,
      },
    );

    console.log(
      JSON.stringify(
        {
          ...baseOutput,
          applyStartedAt: applyStartedAt.toISOString(),
          updatedCounts: {
            categoryA: transactionResult.updatedCategoryA,
            categoryB: transactionResult.updatedCategoryB,
          },
          rollback: {
            instruction:
              "Use the emitted before values, keyed by id, to construct a separately reviewed transactional rollback. No rollback is executed by this tool.",
            rows: transactionResult.changes,
          },
          verification:
            "FINISHED + CLOSED + COMPLETED for every changed row; endedAt, updatedAt, and all selected historical metadata preserved",
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      ok: false,
      code: "LEGACY_SESSION_TERMINAL_NORMALIZATION_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
