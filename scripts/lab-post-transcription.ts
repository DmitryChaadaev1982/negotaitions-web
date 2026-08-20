import { spawn } from "node:child_process";

import { parseLabScenarioIds } from "../tests/e2e/helpers/post-transcription-lab-catalog";
import {
  assertPostTranscriptionLabSafety,
  buildPostTranscriptionLabEnvironment,
} from "../tests/e2e/helpers/post-transcription-lab-safety";

function parseArgs(argv: string[]) {
  const smoke = argv.includes("--smoke");
  const scenarioTokens = argv.filter((token) => !token.startsWith("--"));
  return {
    smoke,
    scenarios: parseLabScenarioIds(scenarioTokens.join(" ")),
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const env = buildPostTranscriptionLabEnvironment({
    LAB_SCENARIOS: parsed.scenarios.join(","),
    LAB_PAUSE: parsed.smoke ? "0" : "1",
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
    "--headed",
    "--workers=1",
  ];
  if (!parsed.smoke) {
    args.push("--timeout=0");
  }

  console.log(
    [
      "Post-processing Facilitator Lab",
      `scenarios=${parsed.scenarios.join(",")}`,
      parsed.smoke ? "mode=smoke (no pause)" : "mode=manual checkpoint (page.pause)",
      "command=npx " + args.join(" "),
    ].join("\n"),
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
