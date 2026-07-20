/**
 * Print the latest POC orchestrator report (sanitized).
 *
 * Usage:
 *   npm run poc:vox:last-report
 *   npm run poc:vox:last-report -- --run-id <runId>
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  getPocRunsDir,
  getPocRunPaths,
  readCurrentPointer,
} from "@/lib/voximplant/poc/poc-run-store";
import { formatLastReportSummary } from "@/lib/voximplant/poc/orchestrator/types";
import { loadPocEnvFiles } from "./load-env";

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

function resolveLatestRunId(): string | null {
  const fromArg = readArg("--run-id");
  if (fromArg) return fromArg;
  const pointer = readCurrentPointer();
  if (pointer) return pointer.runId;

  const dir = getPocRunsDir();
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const reportPath = join(dir, e.name, "report.json");
      const mtime = existsSync(reportPath) ? statSync(reportPath).mtimeMs : 0;
      return { runId: e.name, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return runs[0]?.runId ?? null;
}

function main(): void {
  loadPocEnvFiles();
  const runId = resolveLatestRunId();
  if (!runId) {
    console.log("[poc:vox:last-report] no runs found");
    process.exitCode = 1;
    return;
  }
  const paths = getPocRunPaths(runId);
  if (!existsSync(paths.reportPath)) {
    console.log("[poc:vox:last-report] report missing", { runId });
    process.exitCode = 1;
    return;
  }
  const report = JSON.parse(readFileSync(paths.reportPath, "utf8")) as Record<
    string,
    unknown
  >;
  const { banner, summary } = formatLastReportSummary(report);
  if (banner) {
    console.log(`[poc:vox:last-report] ${banner}`);
  }
  console.log("[poc:vox:last-report]", {
    runId,
    reportPath: paths.reportPath,
    ...summary,
  });
  console.log(JSON.stringify(report, null, 2));
}

main();
