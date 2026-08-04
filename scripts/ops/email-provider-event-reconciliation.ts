import { loadEnvConfig } from "@next/env";
import { parseArgs } from "node:util";

loadEnvConfig(process.cwd());

const parsed = parseArgs({
  options: {
    limit: { type: "string" },
  },
  strict: true,
});

const limit = parsed.values.limit ? Number(parsed.values.limit) : undefined;

void import("@/lib/email/provider-events")
  .then(({ runEmailProviderEventReconciliationSweep }) =>
    runEmailProviderEventReconciliationSweep({ limit }),
  )
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
