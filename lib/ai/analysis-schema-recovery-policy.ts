/**
 * Owned-operation bounds for Stage 3.17A Yandex schema recovery.
 * These are application constants, not env switches.
 */

export const AI_ANALYSIS_MAX_EXTRA_SCHEMA_RECOVERY_GENERATIONS = 1 as const;
export const AI_ANALYSIS_TOTAL_GENERATIONS_MAX = 2 as const;

export const YANDEX_SCHEMA_RECOVERY_ELIGIBLE_PROVIDER = "yandex" as const;
export const YANDEX_SCHEMA_RECOVERY_ELIGIBLE_ERROR_CODE =
  "MODEL_SCHEMA_VALIDATION_ERROR" as const;

export const YANDEX_SCHEMA_RECOVERY_EVENT_TITLE =
  "AI analysis schema recovery: MODEL_SCHEMA_VALIDATION_ERROR";
