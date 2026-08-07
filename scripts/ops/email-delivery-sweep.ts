import { parseArgs } from "node:util";

import { bootstrapOperationalEnv } from "@/lib/operational-env";

bootstrapOperationalEnv();

const parsed = parseArgs({
  options: {
    limit: { type: "string" },
  },
  strict: true,
});

const limit = parsed.values.limit ? Number(parsed.values.limit) : undefined;

void import("@/lib/email/worker")
  .then(({ runEmailDeliverySweep }) => runEmailDeliverySweep({ limit }))
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
