import path from "node:path";

import {
  parseCalibrationMarkerList,
  readRawCalibrationInput,
  runPauseFilterCalibration,
  writeCalibrationRunArtifacts,
} from "../lib/transcription/pause-filter-calibration";

type CliArgs = {
  sessionId: string;
  inputPath: string;
  outDir: string;
  activeMarkers: string[];
  pausedMarkers: string[];
};

function getArgValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function readArgs(): CliArgs {
  const sessionId = getArgValue("--sessionId");
  const inputPath = getArgValue("--input");
  const outDir = getArgValue("--out");
  const activeRaw = getArgValue("--active");
  const pausedRaw = getArgValue("--paused");

  if (!sessionId || !inputPath || !outDir || !activeRaw || !pausedRaw) {
    console.error(
      "Usage: tsx scripts/pause-filter-calibrate-session.ts --sessionId <id> --active \"phrase1|phrase2\" --paused \"phrase3|phrase4\" --input <raw-calibration-input.json> --out <session-output-dir>",
    );
    process.exit(1);
  }

  return {
    sessionId,
    inputPath: path.resolve(inputPath),
    outDir: path.resolve(outDir),
    activeMarkers: parseCalibrationMarkerList(activeRaw),
    pausedMarkers: parseCalibrationMarkerList(pausedRaw),
  };
}

async function main() {
  const args = readArgs();
  const outSessionId = path.basename(args.outDir);
  if (outSessionId !== args.sessionId) {
    console.warn(
      `Warning: --out basename (${outSessionId}) differs from --sessionId (${args.sessionId}). Using --out path.`,
    );
  }
  const input = await readRawCalibrationInput(args.inputPath);
  const runResult = runPauseFilterCalibration({
    input,
    activeMarkers: args.activeMarkers,
    pausedMarkers: args.pausedMarkers,
  });

  const artifactPaths = await writeCalibrationRunArtifacts({
    calibrationDir: path.dirname(args.outDir),
    sessionId: path.basename(args.outDir),
    input,
    runResult,
  });

  console.log("Pause-filter calibration completed.");
  console.log(`Session: ${args.sessionId}`);
  console.log(`Inconclusive: ${runResult.inconclusive ? "yes" : "no"}`);
  console.log(
    `Recommended: ${runResult.recommendedRule?.candidateId ?? "none (inconclusive)"}`,
  );
  console.log(`Artifacts: ${artifactPaths.sessionDir}`);
}

void main();
