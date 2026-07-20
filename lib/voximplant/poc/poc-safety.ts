/**
 * Safety gates for the isolated Voximplant server-stop POC.
 * Prevents accidental use of production routing rules / conference names.
 */

/** Required prefix for live POC conference names (Checkpoint A). */
export const POC_CONFERENCE_NAME_PREFIX = "neg-poc-server-stop-";

/** Stable scenario identity returned by the dedicated POC scenario. */
export const POC_SCENARIO_KIND = "voximplant_server_stop_poc";
export const POC_PROTOCOL_VERSION = 1;

/** Dedicated POC scenario source / build (must match pasted scenario). */
export const POC_SCENARIO_SOURCE_NAME = "neg-conf-server-stop-poc";
export const POC_EXPECTED_SCENARIO_BUILD = "server-stop-poc-2026-07-20-c2";

/**
 * Known production / default room routing identities from repo docs.
 * Used as a hard deny-list in addition to live env production config.
 */
export const KNOWN_PRODUCTION_RULE_NAMES = [
  "negotaitions-negotiation-room-rule",
  "negotaitions-conference-rule",
] as const;

export const KNOWN_PRODUCTION_SCENARIO_NAMES = [
  "neg-conf-main-room",
  "neg-conf",
] as const;

/** Production scenario build marker observed on the failed dual-session run. */
export const KNOWN_PRODUCTION_SCENARIO_BUILDS = [
  "server-poc-webhook-fix-2026-07-04",
] as const;

export type PocSafetyErrorCode =
  | "POC_RULE_ID_REQUIRED"
  | "POC_RULE_MATCHES_PRODUCTION"
  | "LIVE_POC_CONFIRMATION_REQUIRED"
  | "INVALID_POC_CONFERENCE_NAME"
  | "UNEXPECTED_SCENARIO_IDENTITY"
  | "POC_BROWSER_ROUTED_TO_PRODUCTION_RULE"
  | "POC_UNEXPECTED_SCENARIO"
  | "POC_UNEXPECTED_SCENARIO_BUILD"
  | "POC_PROVIDER_SESSION_ID_MISMATCH"
  | "POC_MULTIPLE_PROVIDER_SESSIONS_DETECTED";

export type PocSafetySanitizedDetails = {
  selectedPocRuleId: string | null;
  selectedPocRuleName: string | null;
  productionRuleFingerprint: string | null;
  refusalReason: string;
};

export class PocSafetyError extends Error {
  readonly code: PocSafetyErrorCode;
  readonly details: PocSafetySanitizedDetails;

  constructor(code: PocSafetyErrorCode, details: PocSafetySanitizedDetails) {
    super(`${code}: ${details.refusalReason}`);
    this.name = "PocSafetyError";
    this.code = code;
    this.details = details;
  }

  /** Safe for console — never includes secrets or full control URLs. */
  toSanitizedLog(): Record<string, unknown> {
    return {
      code: this.code,
      selectedPocRuleId: this.details.selectedPocRuleId,
      selectedPocRuleName: this.details.selectedPocRuleName,
      productionRuleFingerprint: this.details.productionRuleFingerprint,
      refusalReason: this.details.refusalReason,
    };
  }
}

export function maskRuleIdentifier(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length <= 4) return "****";
  return `${trimmed.slice(0, 2)}…${trimmed.slice(-2)} (len=${trimmed.length})`;
}

export type ProductionRuleDenyList = {
  productionRuleId: string | null;
  productionRuleName: string | null;
  productionScenarioName: string | null;
};

/** Read production / default room rule config for deny-list comparison only. */
export function readProductionRuleDenyList(
  env: NodeJS.ProcessEnv = process.env,
): ProductionRuleDenyList {
  return {
    productionRuleId: env.VOXIMPLANT_MANAGEMENT_RULE_ID?.trim() || null,
    productionRuleName: env.VOXIMPLANT_RULE_NAME?.trim() || null,
    productionScenarioName: env.VOXIMPLANT_SCENARIO_NAME?.trim() || null,
  };
}

export type ResolvedPocRule = {
  ruleId: string | null;
  ruleName: string | null;
  /** True when rule came from dedicated POC env (never production fallbacks). */
  fromDedicatedPocEnv: boolean;
};

/**
 * Resolve dedicated POC rule identity only.
 * Never falls back to VOXIMPLANT_MANAGEMENT_RULE_ID, VOXIMPLANT_RULE_NAME,
 * or GetRules discovery.
 */
export function resolveDedicatedPocRule(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedPocRule {
  const ruleId = env.VOXIMPLANT_SERVER_STOP_POC_RULE_ID?.trim() || null;
  const ruleName = env.VOXIMPLANT_SERVER_STOP_POC_RULE_NAME?.trim() || null;
  return {
    ruleId,
    ruleName,
    fromDedicatedPocEnv: Boolean(ruleId || ruleName),
  };
}

export function assertLivePocConfirmation(confirmLivePoc: boolean): void {
  if (confirmLivePoc) return;
  throw new PocSafetyError("LIVE_POC_CONFIRMATION_REQUIRED", {
    selectedPocRuleId: null,
    selectedPocRuleName: null,
    productionRuleFingerprint: null,
    refusalReason:
      "Live StartConference requires --confirm-live-poc. No provider call was made.",
  });
}

export function assertPocConferenceName(conferenceName: string): void {
  const name = conferenceName.trim();
  if (name.startsWith(POC_CONFERENCE_NAME_PREFIX)) return;

  throw new PocSafetyError("INVALID_POC_CONFERENCE_NAME", {
    selectedPocRuleId: null,
    selectedPocRuleName: null,
    productionRuleFingerprint: null,
    refusalReason: `Live POC conference name must start with "${POC_CONFERENCE_NAME_PREFIX}". Rejected name prefix does not match (negotiation-{sessionId} is not allowed for Checkpoint A).`,
  });
}

export function assertExplicitPocRuleIdForLive(pocRule: ResolvedPocRule): void {
  if (pocRule.ruleId) return;
  throw new PocSafetyError("POC_RULE_ID_REQUIRED", {
    selectedPocRuleId: null,
    selectedPocRuleName: pocRule.ruleName,
    productionRuleFingerprint: null,
    refusalReason:
      "Live StartConference requires VOXIMPLANT_SERVER_STOP_POC_RULE_ID. Production VOXIMPLANT_MANAGEMENT_RULE_ID / VOXIMPLANT_RULE_NAME are never used as fallback.",
  });
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Refuse when the selected POC rule matches production / default room routing.
 * Must run before any provider request.
 */
export function assertPocRuleNotProduction(params: {
  pocRule: ResolvedPocRule;
  production: ProductionRuleDenyList;
}): void {
  const { pocRule, production } = params;
  const selectedId = pocRule.ruleId?.trim() || null;
  const selectedName = pocRule.ruleName?.trim() || null;

  const productionFingerprint =
    maskRuleIdentifier(production.productionRuleId) ??
    maskRuleIdentifier(production.productionRuleName) ??
    maskRuleIdentifier(production.productionScenarioName);

  const baseDetails = {
    selectedPocRuleId: selectedId,
    selectedPocRuleName: selectedName,
    productionRuleFingerprint: productionFingerprint,
  };

  if (
    selectedId &&
    production.productionRuleId &&
    selectedId === production.productionRuleId
  ) {
    throw new PocSafetyError("POC_RULE_MATCHES_PRODUCTION", {
      ...baseDetails,
      refusalReason:
        "Selected POC rule ID matches production VOXIMPLANT_MANAGEMENT_RULE_ID.",
    });
  }

  if (
    selectedName &&
    production.productionRuleName &&
    normalizeIdentity(selectedName) === normalizeIdentity(production.productionRuleName)
  ) {
    throw new PocSafetyError("POC_RULE_MATCHES_PRODUCTION", {
      ...baseDetails,
      refusalReason:
        "Selected POC rule name matches production VOXIMPLANT_RULE_NAME.",
    });
  }

  if (
    selectedName &&
    KNOWN_PRODUCTION_RULE_NAMES.some(
      (name) => normalizeIdentity(name) === normalizeIdentity(selectedName),
    )
  ) {
    throw new PocSafetyError("POC_RULE_MATCHES_PRODUCTION", {
      ...baseDetails,
      refusalReason:
        "Selected POC rule name matches a known production/default room routing rule.",
    });
  }

  // Guard misuse where operators paste a scenario name into the POC rule name slot.
  if (
    selectedName &&
    (KNOWN_PRODUCTION_SCENARIO_NAMES.some(
      (name) => normalizeIdentity(name) === normalizeIdentity(selectedName),
    ) ||
      (production.productionScenarioName &&
        normalizeIdentity(selectedName) ===
          normalizeIdentity(production.productionScenarioName)))
  ) {
    throw new PocSafetyError("POC_RULE_MATCHES_PRODUCTION", {
      ...baseDetails,
      refusalReason:
        "Selected POC rule name matches production/default conference scenario identity (not a dedicated POC rule).",
    });
  }
}

export type ScenarioIdentityFields = {
  scenarioKind: string | null;
  protocolVersion: number | null;
};

export function assertPocScenarioIdentity(identity: ScenarioIdentityFields): void {
  const kindOk = identity.scenarioKind === POC_SCENARIO_KIND;
  const versionOk = identity.protocolVersion === POC_PROTOCOL_VERSION;
  if (kindOk && versionOk) return;

  const reasons: string[] = [];
  if (identity.scenarioKind == null || identity.scenarioKind === "") {
    reasons.push("missing scenarioKind");
  } else if (!kindOk) {
    reasons.push(`unexpected scenarioKind=${identity.scenarioKind}`);
  }
  if (identity.protocolVersion == null) {
    reasons.push("missing protocolVersion");
  } else if (!versionOk) {
    reasons.push(`unexpected protocolVersion=${identity.protocolVersion}`);
  }

  throw new PocSafetyError("UNEXPECTED_SCENARIO_IDENTITY", {
    selectedPocRuleId: null,
    selectedPocRuleName: null,
    productionRuleFingerprint: null,
    refusalReason: `Callback/identity is not the dedicated POC scenario (${reasons.join("; ")}). HTTP 200 on the control URL alone is never sufficient; use signed async callback confirmation.`,
  });
}

/** Refuse production routing-rule identity reported by a provider session. */
export function assertPocProviderRuleIdentity(ruleIdentity: string | null | undefined): void {
  const raw = ruleIdentity?.trim() || "";
  if (!raw) return;
  if (
    KNOWN_PRODUCTION_RULE_NAMES.some(
      (name) => normalizeIdentity(name) === normalizeIdentity(raw),
    )
  ) {
    throw new PocSafetyError("POC_BROWSER_ROUTED_TO_PRODUCTION_RULE", {
      selectedPocRuleId: null,
      selectedPocRuleName: raw,
      productionRuleFingerprint: maskRuleIdentifier(raw),
      refusalReason: `Provider session reported production routing rule "${raw}".`,
    });
  }
}

/** Refuse unexpected scenario source name (e.g. production neg-conf). */
export function assertPocProviderScenarioSource(
  scenarioSource: string | null | undefined,
): void {
  const raw = scenarioSource?.trim() || "";
  if (!raw) return;
  if (
    KNOWN_PRODUCTION_SCENARIO_NAMES.some(
      (name) => normalizeIdentity(name) === normalizeIdentity(raw),
    )
  ) {
    throw new PocSafetyError("POC_UNEXPECTED_SCENARIO", {
      selectedPocRuleId: null,
      selectedPocRuleName: null,
      productionRuleFingerprint: maskRuleIdentifier(raw),
      refusalReason: `Provider session reported production scenario "${raw}".`,
    });
  }
  if (normalizeIdentity(raw) !== normalizeIdentity(POC_SCENARIO_SOURCE_NAME)) {
    throw new PocSafetyError("POC_UNEXPECTED_SCENARIO", {
      selectedPocRuleId: null,
      selectedPocRuleName: null,
      productionRuleFingerprint: maskRuleIdentifier(raw),
      refusalReason: `Provider session scenario source "${raw}" is not ${POC_SCENARIO_SOURCE_NAME}.`,
    });
  }
}

/** Refuse unexpected / production scenario build markers. */
export function assertPocProviderScenarioBuild(
  scenarioBuild: string | null | undefined,
): void {
  const raw = scenarioBuild?.trim() || "";
  if (!raw) {
    throw new PocSafetyError("POC_UNEXPECTED_SCENARIO_BUILD", {
      selectedPocRuleId: null,
      selectedPocRuleName: null,
      productionRuleFingerprint: null,
      refusalReason: "Provider session did not report scenarioBuild.",
    });
  }
  if (
    KNOWN_PRODUCTION_SCENARIO_BUILDS.some(
      (build) => normalizeIdentity(build) === normalizeIdentity(raw),
    )
  ) {
    throw new PocSafetyError("POC_UNEXPECTED_SCENARIO_BUILD", {
      selectedPocRuleId: null,
      selectedPocRuleName: null,
      productionRuleFingerprint: maskRuleIdentifier(raw),
      refusalReason: `Provider session reported production scenario build "${raw}".`,
    });
  }
  if (raw !== POC_EXPECTED_SCENARIO_BUILD) {
    throw new PocSafetyError("POC_UNEXPECTED_SCENARIO_BUILD", {
      selectedPocRuleId: null,
      selectedPocRuleName: null,
      productionRuleFingerprint: maskRuleIdentifier(raw),
      refusalReason: `Provider session scenarioBuild "${raw}" is not ${POC_EXPECTED_SCENARIO_BUILD}.`,
    });
  }
}

/** Format a safety refusal for CLI without dumping request/response objects. */
export function formatPocSafetyRefusal(error: unknown): Record<string, unknown> {
  if (error instanceof PocSafetyError) {
    return error.toSanitizedLog();
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "POC_ERROR", refusalReason: message };
}
