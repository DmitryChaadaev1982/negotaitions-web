import { parseArgs } from "node:util";

import type {
  NegotiationState,
  RoomLifecycle,
  SessionStatus,
} from "@/app/generated/prisma/client";

export const LEGACY_TERMINAL_SAMPLE_LIMIT_DEFAULT = 25;
export const LEGACY_TERMINAL_APPLY_LIMIT = 5_000;

export type LegacyTerminalCategory =
  | "CATEGORY_A_CLOSED_STALE_STATUS"
  | "CATEGORY_B_FINISHED_NULL_LIFECYCLE";

export const LEGACY_TERMINAL_REPAIR_FIELDS = {
  categoryA: ["status"],
  categoryB: ["status", "roomLifecycle"],
} as const;

export type LegacyTerminalCandidateInput = {
  negotiationState: NegotiationState;
  roomLifecycle: RoomLifecycle | null;
  status: SessionStatus;
  negotiationEndedAt: Date | null;
  deletedAt: Date | null;
};

export type LegacyTerminalNormalizationCli = {
  apply: boolean;
  expectedCategoryA: number | null;
  expectedCategoryB: number | null;
  sampleLimit: number;
};

function parseNonNegativeInteger(
  value: string | undefined,
  optionName: string,
): number | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${optionName} must be a non-negative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${optionName} must be a safe non-negative integer.`);
  }
  return parsed;
}

export function classifyLegacyTerminalCandidate(
  session: LegacyTerminalCandidateInput,
): LegacyTerminalCategory | null {
  if (
    session.deletedAt !== null ||
    session.negotiationState !== "FINISHED" ||
    session.roomLifecycle === "DEBRIEF_OPEN" ||
    session.roomLifecycle === "OPEN"
  ) {
    return null;
  }

  if (
    session.roomLifecycle === "CLOSED" &&
    session.status !== "COMPLETED"
  ) {
    return "CATEGORY_A_CLOSED_STALE_STATUS";
  }

  if (
    session.roomLifecycle === null &&
    session.negotiationEndedAt !== null
  ) {
    return "CATEGORY_B_FINISHED_NULL_LIFECYCLE";
  }

  return null;
}

export function parseLegacyTerminalNormalizationCli(
  args: string[],
): LegacyTerminalNormalizationCli {
  const parsed = parseArgs({
    args,
    options: {
      apply: { type: "boolean", default: false },
      "expected-category-a": { type: "string" },
      "expected-category-b": { type: "string" },
      "sample-limit": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const expectedCategoryA = parseNonNegativeInteger(
    parsed.values["expected-category-a"],
    "--expected-category-a",
  );
  const expectedCategoryB = parseNonNegativeInteger(
    parsed.values["expected-category-b"],
    "--expected-category-b",
  );
  const parsedSampleLimit = parseNonNegativeInteger(
    parsed.values["sample-limit"],
    "--sample-limit",
  );
  const sampleLimit = Math.min(
    parsedSampleLimit ?? LEGACY_TERMINAL_SAMPLE_LIMIT_DEFAULT,
    100,
  );
  const apply = Boolean(parsed.values.apply);

  if (apply && (expectedCategoryA === null || expectedCategoryB === null)) {
    throw new Error(
      "--apply requires --expected-category-a and --expected-category-b.",
    );
  }

  return {
    apply,
    expectedCategoryA,
    expectedCategoryB,
    sampleLimit,
  };
}

export function assertLegacyTerminalExpectedCounts(params: {
  actualCategoryA: number;
  actualCategoryB: number;
  expectedCategoryA: number;
  expectedCategoryB: number;
}) {
  if (
    params.actualCategoryA !== params.expectedCategoryA ||
    params.actualCategoryB !== params.expectedCategoryB
  ) {
    throw new Error(
      `Candidate count mismatch: expected A=${params.expectedCategoryA}, B=${params.expectedCategoryB}; actual A=${params.actualCategoryA}, B=${params.actualCategoryB}.`,
    );
  }

  if (
    params.actualCategoryA + params.actualCategoryB >
    LEGACY_TERMINAL_APPLY_LIMIT
  ) {
    throw new Error(
      `Candidate count exceeds safety limit ${LEGACY_TERMINAL_APPLY_LIMIT}.`,
    );
  }
}
