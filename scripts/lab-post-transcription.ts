import "dotenv/config";
import { spawn } from "node:child_process";

import {
  isBug02LabScenario,
  parseLabScenarioIds,
  type PostTranscriptionLabScenarioId,
} from "../tests/e2e/helpers/post-transcription-lab-catalog";
import {
  BUG02_AUTOMATED_SCENARIO_IDS,
  BUG02_UAT_SCENARIO_IDS,
} from "../tests/e2e/helpers/post-transcription-lab-bug02";
import {
  assertPostTranscriptionLabSafety,
  buildPostTranscriptionLabEnvironment,
} from "../tests/e2e/helpers/post-transcription-lab-safety";

function parseArgs(argv: string[]) {
  const bug02Uat = argv.includes("--bug02-uat");
  const bug02Automated = argv.includes("--bug02-automated");
  const smoke = argv.includes("--smoke") || bug02Automated;
  const headless = argv.includes("--headless") || (bug02Automated && smoke);
  const scenarioTokens = argv.filter((token) => !token.startsWith("--"));
  let scenarios: PostTranscriptionLabScenarioId[];
  if (scenarioTokens.length > 0) {
    scenarios = parseLabScenarioIds(scenarioTokens.join(" "));
  } else if (bug02Uat) {
    scenarios = [...BUG02_UAT_SCENARIO_IDS];
  } else if (bug02Automated) {
    scenarios = [...BUG02_AUTOMATED_SCENARIO_IDS];
  } else {
    scenarios = parseLabScenarioIds("");
  }
  return {
    smoke,
    headless: headless || (bug02Uat && smoke),
    bug02Uat,
    bug02Automated,
    scenarios,
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const env = buildPostTranscriptionLabEnvironment({
    LAB_SCENARIOS: parsed.scenarios.join(","),
    LAB_PAUSE: parsed.smoke ? "0" : "1",
    LAB_BUG02_UAT: parsed.bug02Uat ? "1" : "0",
    PLAYWRIGHT_SERVER_MODE: "managed",
  });

  Object.assign(process.env, env);
  assertPostTranscriptionLabSafety(process.env);

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    "playwright",
    "test",
    "--config",
    "playwright.local.config.ts",
    "tests/e2e/post-transcription-lab.spec.ts",
    "--project=chromium",
    "--workers=1",
  ];
  if (!parsed.headless) {
    args.push("--headed");
  }
  if (!parsed.smoke) {
    args.push("--timeout=0");
  }

  console.log(
    [
      "Post-processing Facilitator Lab",
      `scenarios=${parsed.scenarios.join(",")}`,
      parsed.bug02Uat ? "preset=bug02-uat" : null,
      parsed.bug02Automated ? "preset=bug02-automated" : null,
      parsed.smoke ? "mode=smoke (no pause)" : "mode=manual checkpoint (page.pause)",
      parsed.headless ? "browser=headless" : "browser=headed",
      "command=npx " + args.join(" "),
      parsed.scenarios.some((id) => isBug02LabScenario(id))
        ? "BUG02 scenarios use real Product routes and APIs."
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const child = spawn(npx, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  const exitCode: number = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  process.exit(exitCode);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
