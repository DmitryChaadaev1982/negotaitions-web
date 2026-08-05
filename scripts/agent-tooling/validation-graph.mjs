/**
 * Machine-readable npm validation dependency graph for NegotAItions.
 * Source of truth for validate:agent planning and deduplication.
 */

/** @typedef {"cheap"|"medium"|"heavy"} CostCategory */

/**
 * @typedef {Object} Primitive
 * @property {string} id
 * @property {string} label
 * @property {string[]} command
 * @property {CostCategory} cost
 * @property {string} assurance
 * @property {boolean} startsServer
 * @property {boolean} installsPlaywright
 * @property {boolean} generatesPrisma
 * @property {boolean} buildsNext
 * @property {boolean} runsUnitTests
 * @property {boolean} runsPlaywright
 * @property {boolean} usesDisposableDb
 * @property {string[]} [notes]
 */

/**
 * @typedef {Object} Composite
 * @property {string} id
 * @property {string} npmScript
 * @property {string} definition
 * @property {string[]} primitives
 * @property {string[]} [callsScripts]
 * @property {CostCategory} cost
 */

/** @type {Record<string, Primitive>} */
export const PRIMITIVES = {
  lint: {
    id: "lint",
    label: "ESLint",
    command: ["npm", "run", "lint"],
    cost: "cheap",
    assurance: "Static lint of application and tooling sources",
    startsServer: false,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: false,
    runsUnitTests: false,
    runsPlaywright: false,
    usesDisposableDb: false,
  },
  "prisma-validate": {
    id: "prisma-validate",
    label: "Prisma validate",
    command: ["npx", "prisma", "validate"],
    cost: "cheap",
    assurance: "Prisma schema structural validation",
    startsServer: false,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: false,
    runsUnitTests: false,
    runsPlaywright: false,
    usesDisposableDb: false,
  },
  "prisma-generate": {
    id: "prisma-generate",
    label: "Prisma generate",
    command: ["npx", "prisma", "generate"],
    cost: "medium",
    assurance: "Regenerate Prisma client bindings",
    startsServer: false,
    installsPlaywright: false,
    generatesPrisma: true,
    buildsNext: false,
    runsUnitTests: false,
    runsPlaywright: false,
    usesDisposableDb: false,
  },
  "test-unit": {
    id: "test-unit",
    label: "Unit tests (lib/**/*.test.ts)",
    command: ["npm", "run", "test:unit"],
    cost: "medium",
    assurance: "Full Node test runner coverage under lib/",
    startsServer: false,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: false,
    runsUnitTests: true,
    runsPlaywright: false,
    usesDisposableDb: false,
    notes: ["Some *.pg.test.ts files may use DATABASE_URL"],
  },
  "test-e2e-list": {
    id: "test-e2e-list",
    label: "Playwright test inventory",
    command: ["npm", "run", "test:e2e:list"],
    cost: "cheap",
    assurance: "Playwright suite discovers and lists without executing tests",
    startsServer: false,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: false,
    runsUnitTests: false,
    runsPlaywright: false,
    usesDisposableDb: false,
    notes: [
      "May evaluate playwright.config.ts webServer env; set PLAYWRIGHT_BASE_URL to avoid accidental server start",
    ],
  },
  build: {
    id: "build",
    label: "Next.js production build",
    command: ["npm", "run", "build"],
    cost: "heavy",
    assurance: "Production Next.js compile and typecheck",
    startsServer: false,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: true,
    runsUnitTests: false,
    runsPlaywright: false,
    usesDisposableDb: false,
  },
  "email-templates-validate": {
    id: "email-templates-validate",
    label: "Email template registry validate",
    command: ["npm", "run", "email:templates:validate"],
    cost: "cheap",
    assurance: "Email template registry structural checks",
    startsServer: false,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: false,
    runsUnitTests: false,
    runsPlaywright: false,
    usesDisposableDb: false,
  },
  "e2e-smoke": {
    id: "e2e-smoke",
    label: "Managed Chromium @smoke",
    command: ["npm", "run", "test:e2e:smoke"],
    cost: "heavy",
    assurance: "Managed Playwright Chromium @smoke against E2E database",
    startsServer: true,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: false,
    runsUnitTests: false,
    runsPlaywright: true,
    usesDisposableDb: true,
    notes: ["Requires port 3000 free; binds managed Next on 3100"],
  },
  "e2e-smoke-browser": {
    id: "e2e-smoke-browser",
    label: "Managed Chromium @browser-smoke",
    command: ["npm", "run", "test:e2e:smoke:browser"],
    cost: "heavy",
    assurance: "Managed Playwright Chromium @browser-smoke (distinct tag set)",
    startsServer: true,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: false,
    runsUnitTests: false,
    runsPlaywright: true,
    usesDisposableDb: true,
    notes: [
      "Distinct from @smoke; must not be merged with e2e-smoke",
      "Requires port 3000 free; binds managed Next on 3100",
    ],
  },
  "stage310": {
    id: "stage310",
    label: "Stage 3.10 focused unit + managed e2e",
    command: ["npm", "run", "test:stage310"],
    cost: "heavy",
    assurance: "Stage 3.10 lifecycle unit subset plus managed browser suite (excl. observer layout)",
    startsServer: true,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: false,
    runsUnitTests: true,
    runsPlaywright: true,
    usesDisposableDb: true,
    notes: [
      "Unit subset overlaps test:unit files but remains an explicit stage gate",
      "Observer layout matrix excluded via --grep-invert @observer-layout",
    ],
  },
  "stage313c": {
    id: "stage313c",
    label: "Stage 3.13C account-email unit + managed e2e",
    command: ["npm", "run", "test:stage313c"],
    cost: "heavy",
    assurance: "Stage 3.13C email/account unit subset plus managed browser flow",
    startsServer: true,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: false,
    runsUnitTests: true,
    runsPlaywright: true,
    usesDisposableDb: true,
  },
  "stage313c-remediation": {
    id: "stage313c-remediation",
    label: "Stage 3.13C remediation unit tests",
    command: ["npm", "run", "test:stage313c:remediation"],
    cost: "cheap",
    assurance: "Remediation-focused unit coverage (concurrency, payload, timing, journal)",
    startsServer: false,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: false,
    runsUnitTests: true,
    runsPlaywright: false,
    usesDisposableDb: false,
  },
  "agent-tooling-tests": {
    id: "agent-tooling-tests",
    label: "Agent tooling unit tests",
    command: ["npm", "run", "test:agent:tooling"],
    cost: "cheap",
    assurance: "Validation orchestration and agent wrapper unit coverage",
    startsServer: false,
    installsPlaywright: false,
    generatesPrisma: false,
    buildsNext: false,
    runsUnitTests: true,
    runsPlaywright: false,
    usesDisposableDb: false,
  },
};

/** @type {Record<string, Composite>} */
export const COMPOSITES = {
  "validate:fast": {
    id: "validate:fast",
    npmScript: "validate:fast",
    definition: "npm run lint && npx prisma validate && npx prisma generate && npm run test:unit && npm run test:e2e:list",
    primitives: ["lint", "prisma-validate", "prisma-generate", "test-unit", "test-e2e-list"],
    callsScripts: ["lint", "test:unit", "test:e2e:list"],
    cost: "medium",
  },
  "validate:deploy": {
    id: "validate:deploy",
    npmScript: "validate:deploy",
    definition: "npm run validate:fast && npm run build",
    primitives: ["lint", "prisma-validate", "prisma-generate", "test-unit", "test-e2e-list", "build"],
    callsScripts: ["validate:fast", "build"],
    cost: "heavy",
  },
  "test:e2e:smoke": {
    id: "test:e2e:smoke",
    npmScript: "test:e2e:smoke",
    definition: "node scripts/run-playwright-mode.mjs --mode=managed -- --project=chromium --grep @smoke",
    primitives: ["e2e-smoke"],
    cost: "heavy",
  },
  "test:e2e:smoke:browser": {
    id: "test:e2e:smoke:browser",
    npmScript: "test:e2e:smoke:browser",
    definition:
      "node scripts/run-playwright-mode.mjs --mode=managed -- --project=chromium --grep @browser-smoke",
    primitives: ["e2e-smoke-browser"],
    cost: "heavy",
  },
  "test:stage310": {
    id: "test:stage310",
    npmScript: "test:stage310",
    definition: "stage310 unit subset && managed playwright (excl observer layout)",
    primitives: ["stage310"],
    cost: "heavy",
  },
  "test:stage313c": {
    id: "test:stage313c",
    npmScript: "test:stage313c",
    definition: "stage313c unit subset && managed playwright account-email spec",
    primitives: ["stage313c"],
    cost: "heavy",
  },
};

/**
 * Mode → ordered primitive ids (union without composite nesting).
 * Extensions are appended via --with flags.
 */
export const MODE_PRIMITIVES = {
  fast: ["lint", "prisma-validate", "prisma-generate", "test-unit", "test-e2e-list", "email-templates-validate"],
  deploy: [
    "lint",
    "prisma-validate",
    "prisma-generate",
    "test-unit",
    "test-e2e-list",
    "email-templates-validate",
    "build",
  ],
  runtime: ["e2e-smoke", "e2e-smoke-browser"],
  full: [
    "lint",
    "prisma-validate",
    "prisma-generate",
    "test-unit",
    "test-e2e-list",
    "email-templates-validate",
    "build",
    "e2e-smoke",
    "e2e-smoke-browser",
  ],
  tooling: ["agent-tooling-tests"],
};

/** Optional stage/extension packs appended after the mode plan. */
export const EXTENSION_PRIMITIVES = {
  stage310: ["stage310"],
  stage313c: ["stage313c"],
  "stage313c-remediation": ["stage313c-remediation"],
  templates: ["email-templates-validate"],
  tooling: ["agent-tooling-tests"],
};

/**
 * Typical overlapping prompt sequence and how many times each primitive fires.
 */
export const TYPICAL_OVERLAPPING_PROMPT = {
  requestedScripts: [
    "email:templates:validate",
    "prisma validate",
    "prisma generate",
    "test:unit",
    "validate:fast",
    "validate:deploy",
    "test:e2e:smoke",
    "test:e2e:smoke:browser",
    "test:stage310",
  ],
  duplicates: [
    {
      primitive: "lint",
      parents: ["validate:fast", "validate:deploy"],
      executions: 2,
      distinctAssurance: false,
      safeToDedup: true,
      evidence: "validate:deploy calls validate:fast which runs lint",
    },
    {
      primitive: "prisma-validate",
      parents: ["explicit npx prisma validate", "validate:fast", "validate:deploy"],
      executions: 3,
      distinctAssurance: false,
      safeToDedup: true,
      evidence: "Same schema validation; no env/build mode change",
    },
    {
      primitive: "prisma-generate",
      parents: ["explicit npx prisma generate", "validate:fast", "validate:deploy"],
      executions: 3,
      distinctAssurance: false,
      safeToDedup: true,
      evidence: "Same generate; writes same client output",
    },
    {
      primitive: "test-unit",
      parents: ["test:unit", "validate:fast", "validate:deploy"],
      executions: 3,
      distinctAssurance: false,
      safeToDedup: true,
      evidence: "Identical npm run test:unit invoked via nesting",
    },
    {
      primitive: "test-e2e-list",
      parents: ["validate:fast", "validate:deploy"],
      executions: 2,
      distinctAssurance: false,
      safeToDedup: true,
      evidence: "Same playwright --list via validate:fast nesting",
    },
    {
      primitive: "build",
      parents: ["validate:deploy"],
      executions: 1,
      distinctAssurance: true,
      safeToDedup: false,
      evidence: "Only once; retain",
    },
    {
      primitive: "email-templates-validate",
      parents: ["email:templates:validate"],
      executions: 1,
      distinctAssurance: true,
      safeToDedup: false,
      evidence: "Not inside validate:* composites",
    },
    {
      primitive: "e2e-smoke",
      parents: ["test:e2e:smoke"],
      executions: 1,
      distinctAssurance: true,
      safeToDedup: false,
      evidence: "@smoke tag set; distinct from @browser-smoke",
    },
    {
      primitive: "e2e-smoke-browser",
      parents: ["test:e2e:smoke:browser"],
      executions: 1,
      distinctAssurance: true,
      safeToDedup: false,
      evidence: "@browser-smoke tag set; distinct assurance",
    },
    {
      primitive: "stage310",
      parents: ["test:stage310"],
      executions: 1,
      distinctAssurance: true,
      safeToDedup: false,
      evidence:
        "Managed stage suite + unit subset; unit subset overlaps test:unit but stage gate remains explicit when requested",
    },
  ],
};

export function resolvePrimitive(id) {
  const primitive = PRIMITIVES[id];
  if (!primitive) {
    throw new Error(`Unknown validation primitive: ${id}`);
  }
  return primitive;
}

/**
 * Build an ordered, deduplicated plan for a mode + extensions.
 * @param {string} mode
 * @param {string[]} [extensions]
 */
export function buildValidationPlan(mode, extensions = []) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  const base = MODE_PRIMITIVES[normalizedMode];
  if (!base) {
    throw new Error(
      `Unknown mode "${mode}". Supported: ${Object.keys(MODE_PRIMITIVES).join(", ")}`,
    );
  }

  /** @type {string[]} */
  const requested = [...base];
  /** @type {{ id: string, reason: string }[]} */
  const extensionReasons = [];

  for (const raw of extensions) {
    const key = String(raw || "").trim().toLowerCase();
    if (!key) continue;
    const pack = EXTENSION_PRIMITIVES[key];
    if (!pack) {
      throw new Error(
        `Unknown extension "${raw}". Supported: ${Object.keys(EXTENSION_PRIMITIVES).join(", ")}`,
      );
    }
    for (const id of pack) {
      requested.push(id);
      extensionReasons.push({
        id,
        reason: `Requested via --with=${key}`,
      });
    }
  }

  /** @type {string[]} */
  const ordered = [];
  /** @type {string[]} */
  const deduplicated = [];
  const seen = new Set();

  for (const id of requested) {
    if (seen.has(id)) {
      deduplicated.push(id);
      continue;
    }
    seen.add(id);
    ordered.push(id);
  }

  const steps = ordered.map((id) => {
    const primitive = resolvePrimitive(id);
    let reason = `Included by mode=${normalizedMode}`;
    const ext = extensionReasons.find((entry) => entry.id === id);
    if (ext) {
      reason = ext.reason;
    } else if (normalizedMode === "full" && MODE_PRIMITIVES.runtime.includes(id)) {
      reason = "Included by mode=full (deploy union + runtime smokes)";
    } else if (normalizedMode === "full" || normalizedMode === "deploy") {
      if (id === "build") {
        reason = "Deployment-equivalent production build";
      } else if (id === "email-templates-validate") {
        reason = "Cheap distinct template registry check (not nested in validate:*)";
      }
    }
    return {
      id,
      reason,
      cost: primitive.cost,
      assurance: primitive.assurance,
      command: primitive.command,
      startsServer: primitive.startsServer,
      buildsNext: primitive.buildsNext,
      runsPlaywright: primitive.runsPlaywright,
      runsUnitTests: primitive.runsUnitTests,
      generatesPrisma: primitive.generatesPrisma,
      usesDisposableDb: primitive.usesDisposableDb,
    };
  });

  const retainedDistinct = steps
    .filter((step) => ["e2e-smoke", "e2e-smoke-browser", "build", "stage310", "stage313c"].includes(step.id))
    .map((step) => ({
      id: step.id,
      reason: step.assurance,
    }));

  return {
    mode: normalizedMode,
    extensions: extensions.map((value) => String(value).trim().toLowerCase()).filter(Boolean),
    steps,
    deduplicated,
    retainedDistinct,
    estimatedCost: summarizeCost(steps.map((step) => step.cost)),
    concurrencyPolicy: "sequential",
    cachingPolicy: "within-process-dedup-only",
    excludedByDefault: [
      "test:e2e:full",
      "test:e2e:observer:layout",
      "test:e2e:tunnel",
      "test:e2e:live",
      "observer 30/50/100 matrix",
      "production migrations",
      "production SSH",
      "live provider",
      "real email delivery",
    ],
  };
}

function summarizeCost(costs) {
  if (costs.includes("heavy")) return "heavy";
  if (costs.includes("medium")) return "medium";
  return "cheap";
}

export function exportGraphArtifact() {
  return {
    schemaVersion: 1,
    generatedFor: "chore/agent-test-performance-optimization",
    primitives: PRIMITIVES,
    composites: COMPOSITES,
    modes: MODE_PRIMITIVES,
    extensions: EXTENSION_PRIMITIVES,
    typicalOverlappingPrompt: TYPICAL_OVERLAPPING_PROMPT,
  };
}
