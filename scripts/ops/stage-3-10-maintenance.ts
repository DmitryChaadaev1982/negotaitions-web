import { parseArgs } from "node:util";

import { bootstrapOperationalEnv } from "@/lib/operational-env";
import {
  runVoximplantCallbackNonceCleanup,
  runRecordingStopDeliverySweep,
  runRoomLifecycleBackfill,
  runSessionConnectionExpirySweep,
  verifyRoomLifecycleBackfill,
} from "@/lib/stage-3-10-maintenance";

bootstrapOperationalEnv();

type TaskName =
  | "all"
  | "expiry"
  | "recording-stop"
  | "nonce-cleanup"
  | "backfill"
  | "verify-backfill";

type CliValues = {
  task?: TaskName;
  limit?: string;
  "batch-size"?: string;
  "cursor-after-id"?: string;
  "dry-run"?: boolean;
};

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseCli(): CliValues {
  const parsed = parseArgs({
    options: {
      task: { type: "string" },
      limit: { type: "string" },
      "batch-size": { type: "string" },
      "cursor-after-id": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });
  return parsed.values as CliValues;
}

async function main() {
  const args = parseCli();
  const task = (args.task ?? "all") as TaskName;
  const dryRun = Boolean(args["dry-run"]);
  const limit = parseNumber(args.limit, 500);
  const batchSize = parseNumber(args["batch-size"], 500);
  const cursorAfterId = args["cursor-after-id"]?.trim() || null;

  if (
    ![
      "all",
      "expiry",
      "recording-stop",
      "nonce-cleanup",
      "backfill",
      "verify-backfill",
    ].includes(task)
  ) {
    throw new Error(`Unsupported --task value: ${task}`);
  }

  const output: Record<string, unknown> = {
    task,
    dryRun,
    startedAt: new Date().toISOString(),
  };

  if (task === "all" || task === "expiry") {
    output.expiry = await runSessionConnectionExpirySweep({ dryRun, limit });
  }
  if (task === "all" || task === "recording-stop") {
    output.recordingStop = await runRecordingStopDeliverySweep({ dryRun, limit });
  }
  if (task === "all" || task === "nonce-cleanup") {
    output.nonceCleanup = await runVoximplantCallbackNonceCleanup({ dryRun });
  }
  if (task === "all" || task === "backfill") {
    output.backfill = await runRoomLifecycleBackfill({
      dryRun,
      batchSize,
      cursorAfterId,
    });
  }
  if (task === "all" || task === "verify-backfill") {
    output.backfillVerification = await verifyRoomLifecycleBackfill();
  }

  output.completedAt = new Date().toISOString();
  console.log(JSON.stringify(output, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
