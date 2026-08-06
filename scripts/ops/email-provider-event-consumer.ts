import { loadEnvConfig } from "@next/env";
import { parseArgs } from "node:util";

loadEnvConfig(process.cwd());

const parsed = parseArgs({
  options: {
    once: { type: "boolean", default: false },
  },
  strict: true,
});

const controller = new AbortController();
let shuttingDown = false;

function requestShutdown(signalName: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(
    JSON.stringify({
      area: "email_provider_events",
      event: "shutdown_requested",
      signal: signalName,
    }),
  );
  controller.abort();
}

process.once("SIGTERM", requestShutdown);
process.once("SIGINT", requestShutdown);

void import("@/lib/email/provider-event-consumer")
  .then(({ runEmailProviderEventConsumer }) =>
    runEmailProviderEventConsumer({
      signal: controller.signal,
      once: Boolean(parsed.values.once),
    }),
  )
  .then((result) => {
    console.log(
      JSON.stringify({
        area: "email_provider_events",
        event: "consumer_completed",
        ...result,
      }),
    );
  })
  .catch((error) => {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "PROVIDER_EVENT_CONSUMER_FAILED";
    const message =
      error instanceof Error
        ? error.message
        : "Provider-event consumer failed.";
    console.error(
      JSON.stringify({
        area: "email_provider_events",
        event: "consumer_failed",
        code,
        message,
      }),
    );
    process.exitCode = 1;
  });
