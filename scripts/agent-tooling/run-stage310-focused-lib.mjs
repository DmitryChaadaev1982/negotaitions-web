import fs from "node:fs/promises";
import path from "node:path";

import { git, runCommand } from "./common.mjs";

const PRE_FLIGHT_MAX_AGE_MS = 15 * 60_000;
const SNAPSHOT_PATH = ".agent/preflight.json";

const UNIT_CANDIDATES = [
  "lib/session-room-access.test.ts",
  "lib/session-room-lifecycle.test.ts",
  "lib/session-active-presence.test.ts",
  "lib/recording-display-state.test.ts",
  "lib/recording-stop-delivery-policy.test.ts",
  "lib/env.voximplant-server-stop.test.ts",
  "lib/session-recording-stop-relay.test.ts",
  "lib/stage-3-10-maintenance.test.ts",
  "lib/voximplant/server-stop-callback-signature.test.ts",
  "lib/voximplant/server-stop-client.test.ts",
  "lib/session-role-ui-state.test.ts",
  "lib/event-role-ui-state.test.ts",
  "lib/session-control-recording-policy.test.ts",
  "lib/event-overview-stats.test.ts",
  "lib/voximplant/use-voximplant-room.lifecycle.test.ts",
];

const E2E_CANDIDATES = [
  "tests/e2e/session-finish-canonical.spec.ts",
  "tests/e2e/event-completion.spec.ts",
  "tests/e2e/voximplant-room-presence.spec.ts",
];

const VALID_MODES = new Set(["managed", "live"]);

export class Stage310FocusedError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveFocusedMode({ explicitMode, repositoryRoot, branch, readFile = fs.readFile }) {
  if (explicitMode) {
    if (!VALID_MODES.has(explicitMode)) {
      throw new Stage310FocusedError(
        "INVALID_PLAYWRIGHT_SERVER_MODE",
        `Unsupported mode "${explicitMode}".`,
      );
    }
    return explicitMode;
  }

  const snapshotFile = path.join(repositoryRoot, SNAPSHOT_PATH);
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
  } catch {
    throw new Stage310FocusedError(
      "PREFLIGHT_REQUIRED",
      "Missing .agent/preflight.json. Run npm run agent:preflight, then rerun with explicit :live or :managed if needed.",
    );
  }

  const generatedAt = new Date(snapshot.generatedAt).getTime();
  const now = Date.now();
  const fresh = Number.isFinite(generatedAt) && now - generatedAt <= PRE_FLIGHT_MAX_AGE_MS;
  const rootMatches = snapshot.repositoryRoot === repositoryRoot;
  const branchMatches = snapshot.branch === branch;
  const suggested = String(snapshot.recommendedPlaywrightMode || "").toUpperCase();
  const conflictingSuggestion =
    suggested === "SIBLING_WORKTREE_CONFLICT" || suggested === "PROCESS_CONFLICT";

  if (
    !fresh ||
    !rootMatches ||
    !branchMatches ||
    conflictingSuggestion ||
    !["LIVE", "MANAGED"].includes(suggested)
  ) {
    throw new Stage310FocusedError(
      "PREFLIGHT_REQUIRED",
      "Preflight snapshot is missing, stale, mismatched, or unsafe. Run npm run agent:preflight then use npm run test:stage310:focused:live or npm run test:stage310:focused:managed.",
    );
  }

  return suggested.toLowerCase();
}

export async function selectFocusedTests(repositoryRoot, deps = {}) {
  const exists = deps.fileExists ?? fileExists;
  const selectedUnitTests = [];
  const missingUnitCandidates = [];
  for (const candidate of UNIT_CANDIDATES) {
    if (await exists(path.join(repositoryRoot, candidate))) {
      selectedUnitTests.push(candidate);
    } else {
      missingUnitCandidates.push(candidate);
    }
  }

  const selectedE2eTests = [];
  const missingE2eCandidates = [];
  for (const candidate of E2E_CANDIDATES) {
    if (await exists(path.join(repositoryRoot, candidate))) {
      selectedE2eTests.push(candidate);
    } else {
      missingE2eCandidates.push(candidate);
    }
  }

  return { selectedUnitTests, selectedE2eTests, missingUnitCandidates, missingE2eCandidates };
}

export async function runStage310Focused(argv, deps = {}) {
  const dryRun = argv.includes("--dry-run");
  const explicitModeToken = argv.find((token) => token.startsWith("--mode="));
  const explicitMode = explicitModeToken ? explicitModeToken.slice("--mode=".length).trim() : "";

  const repositoryRoot =
    deps.repositoryRoot ?? (await (deps.git ?? git)(["rev-parse", "--show-toplevel"], { cwd: process.cwd() }));
  const branch = deps.branch ?? (await (deps.git ?? git)(["branch", "--show-current"], { cwd: repositoryRoot }));
  const mode = await resolveFocusedMode({
    explicitMode: explicitMode || undefined,
    repositoryRoot,
    branch,
    readFile: deps.readFile,
  });
  const selection = await selectFocusedTests(repositoryRoot, { fileExists: deps.fileExists });

  if (selection.selectedUnitTests.length === 0) {
    throw new Stage310FocusedError(
      "NO_UNIT_TESTS_SELECTED",
      "No focused Stage 3.10 unit candidates exist in this worktree.",
    );
  }
  if (selection.selectedE2eTests.length === 0) {
    throw new Stage310FocusedError(
      "NO_E2E_TESTS_SELECTED",
      "No focused Stage 3.10 E2E candidates exist in this worktree.",
    );
  }

  if (dryRun) {
    return {
      mode,
      dryRun: true,
      ...selection,
      commands: [
        ["node", ["--import", "tsx", "--test", ...selection.selectedUnitTests]],
        [
          "node",
          [
            "scripts/run-playwright-mode.mjs",
            `--mode=${mode}`,
            "--",
            ...selection.selectedE2eTests,
            "--project=chromium",
          ],
        ],
      ],
    };
  }

  const runner = deps.runCommand ?? runCommand;
  const unitResult = await runner(
    "node",
    ["--import", "tsx", "--test", ...selection.selectedUnitTests],
    {
      cwd: repositoryRoot,
      allowFailure: true,
      timeoutMs: 10 * 60_000,
    },
  );
  if (unitResult.code !== 0) {
    return {
      mode,
      dryRun: false,
      phase: "unit",
      exitCode: unitResult.code,
      stdout: unitResult.stdout,
      stderr: unitResult.stderr,
      ...selection,
    };
  }

  const e2eResult = await runner(
    "node",
    [
      "scripts/run-playwright-mode.mjs",
      `--mode=${mode}`,
      "--",
      ...selection.selectedE2eTests,
      "--project=chromium",
    ],
    {
      cwd: repositoryRoot,
      allowFailure: true,
      timeoutMs: 20 * 60_000,
    },
  );
  return {
    mode,
    dryRun: false,
    phase: "e2e",
    exitCode: e2eResult.code,
    stdout: `${unitResult.stdout ?? ""}${e2eResult.stdout ?? ""}`,
    stderr: `${unitResult.stderr ?? ""}${e2eResult.stderr ?? ""}`,
    ...selection,
  };
}
