import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_REGISTRY_RELATIVE_PATH = "docs/testing/eval-registry.json";

const RISK = new Set(["LOW", "MEDIUM", "HIGH"]);
const EVAL_TYPE = new Set([
  "STATE",
  "TRANSITION",
  "MOUNTED_TRANSITION",
  "HISTORICAL_READ",
  "HISTORICAL_FIRST_MUTATION",
  "MIGRATION_COMPATIBILITY",
  "INTERACTION",
  "PROVIDER_INTEGRATION",
  "MANUAL_PRODUCTION",
]);
const FIXTURE_TYPE = new Set([
  "STATE_FIXTURE",
  "PIPELINE_FIXTURE",
  "SYNTHETIC_HISTORICAL",
  "UNIT",
  "E2E",
  "MANUAL",
  "MIXED",
  "NOT_APPLICABLE",
]);
const AUTOMATION = new Set(["AUTOMATED", "MANUAL", "MIXED"]);
const TRANSITION_KIND = new Set([
  "STATIC",
  "TRANSITION",
  "MOUNTED_TRANSITION",
  "NOT_APPLICABLE",
]);
const COVERAGE_STATUS = new Set(["COVERED", "PARTIAL", "GAP", "MANUAL"]);

const REQUIRED_EVAL_FIELDS = [
  "id",
  "invariant",
  "risk",
  "evalType",
  "fixtureType",
  "expectedDomainResult",
  "expectedUiResult",
  "automation",
  "transitionKind",
  "historicalCohort",
  "requirements",
  "providerCalls",
  "productionSafe",
  "evidence",
  "coverageStatus",
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value) {
  return value === null || typeof value === "string";
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isLiteralEvidencePath(item) {
  if (typeof item !== "string" || item.length === 0) {
    return false;
  }
  if (/\s/.test(item) || item.includes("*") || item.startsWith("npm")) {
    return false;
  }
  return /^(lib|tests|docs|scripts|components|app|prisma|\.cursor)\//.test(item)
    || item === "AGENTS.md"
    || item === "package.json";
}

function push(errors, message) {
  errors.push(message);
}

export function validateRegistryDocument(document, options = {}) {
  const errors = [];
  if (!isPlainObject(document)) {
    return { ok: false, errors: ["Registry document must be a JSON object."] };
  }

  if (typeof document.version !== "number" || !Number.isFinite(document.version)) {
    push(errors, "Registry `version` must be a number.");
  }
  if (typeof document.idPolicy !== "string" || document.idPolicy.trim().length === 0) {
    push(errors, "Registry `idPolicy` must be a non-empty string.");
  }
  if (
    typeof document.maintenance !== "string"
    || document.maintenance.trim().length === 0
  ) {
    push(errors, "Registry `maintenance` must be a non-empty string.");
  }
  if (!Array.isArray(document.evals)) {
    push(errors, "Registry `evals` must be an array.");
    return { ok: false, errors };
  }

  const seenIds = new Map();
  document.evals.forEach((entry, index) => {
    const loc = `evals[${index}]`;
    if (!isPlainObject(entry)) {
      push(errors, `${loc} must be an object.`);
      return;
    }

    for (const field of REQUIRED_EVAL_FIELDS) {
      if (!Object.hasOwn(entry, field)) {
        push(errors, `${loc} is missing required field \`${field}\`.`);
      }
    }

    if (typeof entry.id !== "string" || !/^EVAL-[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(entry.id)) {
      push(
        errors,
        `${loc}.id must match EVAL-<DOMAIN>-<SLUG> using uppercase letters, digits, and hyphens.`,
      );
    } else if (seenIds.has(entry.id)) {
      push(
        errors,
        `Duplicate eval id ${entry.id} at ${loc} (also ${seenIds.get(entry.id)}).`,
      );
    } else {
      seenIds.set(entry.id, loc);
    }

    if (typeof entry.invariant !== "string" || entry.invariant.trim().length === 0) {
      push(errors, `${loc}.invariant must be a non-empty string.`);
    }
    if (typeof entry.expectedDomainResult !== "string") {
      push(errors, `${loc}.expectedDomainResult must be a string.`);
    }
    if (!isNullableString(entry.expectedUiResult)) {
      push(errors, `${loc}.expectedUiResult must be a string or null.`);
    }
    if (!isNullableString(entry.historicalCohort)) {
      push(errors, `${loc}.historicalCohort must be a string or null.`);
    }
    if (!RISK.has(entry.risk)) {
      push(errors, `${loc}.risk has invalid enum value ${JSON.stringify(entry.risk)}.`);
    }
    if (!EVAL_TYPE.has(entry.evalType)) {
      push(errors, `${loc}.evalType has invalid enum value ${JSON.stringify(entry.evalType)}.`);
    }
    if (!FIXTURE_TYPE.has(entry.fixtureType)) {
      push(errors, `${loc}.fixtureType has invalid enum value ${JSON.stringify(entry.fixtureType)}.`);
    }
    if (!AUTOMATION.has(entry.automation)) {
      push(errors, `${loc}.automation has invalid enum value ${JSON.stringify(entry.automation)}.`);
    }
    if (!TRANSITION_KIND.has(entry.transitionKind)) {
      push(
        errors,
        `${loc}.transitionKind has invalid enum value ${JSON.stringify(entry.transitionKind)}.`,
      );
    }
    if (!COVERAGE_STATUS.has(entry.coverageStatus)) {
      push(
        errors,
        `${loc}.coverageStatus has invalid enum value ${JSON.stringify(entry.coverageStatus)}.`,
      );
    }
    if (typeof entry.providerCalls !== "boolean") {
      push(errors, `${loc}.providerCalls must be a boolean.`);
    }
    if (typeof entry.productionSafe !== "boolean") {
      push(errors, `${loc}.productionSafe must be a boolean.`);
    }
    if (!isStringArray(entry.requirements)) {
      push(errors, `${loc}.requirements must be an array of strings.`);
    }
    if (!isStringArray(entry.evidence)) {
      push(errors, `${loc}.evidence must be an array of strings.`);
    } else if (options.checkEvidencePaths) {
      const exists = options.pathExists;
      if (typeof exists !== "function") {
        push(errors, "pathExists callback is required when checkEvidencePaths is true.");
      } else {
        for (const item of entry.evidence) {
          if (isLiteralEvidencePath(item) && !exists(item)) {
            push(errors, `${loc}.evidence path does not exist: ${item}`);
          }
        }
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

export function parseRegistryJson(text) {
  try {
    return { document: JSON.parse(text), errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { document: null, errors: [`Invalid JSON: ${message}`] };
  }
}

export function checkEvalRegistry(options = {}) {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const relativePath = options.relativePath ?? DEFAULT_REGISTRY_RELATIVE_PATH;
  const registryPath = path.join(repositoryRoot, relativePath);
  if (!existsSync(registryPath)) {
    return {
      ok: false,
      registryPath,
      errors: [`Registry file not found: ${relativePath}`],
    };
  }

  const { document, errors: parseErrors } = parseRegistryJson(
    readFileSync(registryPath, "utf8"),
  );
  if (parseErrors.length > 0) {
    return { ok: false, registryPath, errors: parseErrors };
  }

  const result = validateRegistryDocument(document, {
    checkEvidencePaths: options.checkEvidencePaths !== false,
    pathExists: (relativeEvidencePath) =>
      existsSync(path.join(repositoryRoot, relativeEvidencePath)),
  });
  return { ...result, registryPath };
}

export { DEFAULT_REGISTRY_RELATIVE_PATH };
