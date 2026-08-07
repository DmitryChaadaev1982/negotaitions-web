import { parseArgs } from "node:util";

import {
  executeRuntimePermissionNormalization,
  RuntimePermissionError,
  type RuntimePermissionMode,
} from "@/lib/runtime-permissions";

function parseMode(value: string | undefined): RuntimePermissionMode {
  if (value === "check" || value === "apply") return value;
  throw new Error("Usage: runtime-permissions.ts <check|apply>");
}

const parsed = parseArgs({
  allowPositionals: true,
  strict: true,
});
const mode = parseMode(parsed.positionals[0]);

void executeRuntimePermissionNormalization(mode)
  .then((result) => {
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          mode: result.mode,
          changed: result.changed,
          summary: result.summary,
        },
        null,
        2,
      ),
    );
    if (!result.ok) {
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    const code =
      error instanceof RuntimePermissionError
        ? error.code
        : "RUNTIME_PERMISSION_NORMALIZATION_FAILED";
    console.error(JSON.stringify({ ok: false, code }));
    process.exitCode = 1;
  });
