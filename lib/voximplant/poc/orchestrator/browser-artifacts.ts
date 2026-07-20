import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { sanitizePocDiagnosticLog } from "@/lib/voximplant/poc/log-sanitize";
import {
  getPocRunPaths,
  writeJsonArtifact,
} from "@/lib/voximplant/poc/poc-run-store";

import type { BrowserContextEvidence } from "./browser-stages";

export function getBrowserArtifactDirs(
  runId: string,
  stateRoot?: string,
): { facilitatorDir: string; participantDir: string; browserRoot: string } {
  const paths = getPocRunPaths(runId, stateRoot);
  const browserRoot = join(paths.runDir, "browser");
  return {
    browserRoot,
    facilitatorDir: join(browserRoot, "facilitator"),
    participantDir: join(browserRoot, "participant"),
  };
}

export function persistBrowserContextArtifacts(params: {
  runId: string;
  stateRoot?: string;
  facilitator: BrowserContextEvidence;
  participant: BrowserContextEvidence;
  extra?: Record<string, unknown>;
}): { facilitatorDir: string; participantDir: string } {
  const dirs = getBrowserArtifactDirs(params.runId, params.stateRoot);
  mkdirSync(dirs.facilitatorDir, { recursive: true });
  mkdirSync(dirs.participantDir, { recursive: true });

  const writeRole = (
    dir: string,
    evidence: BrowserContextEvidence,
  ): void => {
    writeJsonArtifact(
      join(dir, "browser-state.json"),
      sanitizePocDiagnosticLog({
        ...evidence,
        // Never persist cookie/token-bearing fields if present on extras.
        extra: params.extra ?? null,
      }),
    );
    writeJsonArtifact(
      join(dir, "access-selection.json"),
      sanitizePocDiagnosticLog(evidence.access),
    );
    writeJsonArtifact(
      join(dir, "console-errors.json"),
      sanitizePocDiagnosticLog({
        consoleErrors: evidence.consoleErrors,
        pageErrors: evidence.pageErrors,
        failedRequestPaths: evidence.failedRequestPaths,
        pageUrlPath: evidence.pageUrlPath,
      }),
    );
  };

  writeRole(dirs.facilitatorDir, params.facilitator);
  writeRole(dirs.participantDir, params.participant);
  return dirs;
}
