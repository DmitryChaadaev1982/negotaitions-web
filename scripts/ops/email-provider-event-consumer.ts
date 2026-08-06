import { loadEnvConfig } from "@next/env";
import { parseArgs } from "node:util";

loadEnvConfig(process.cwd());

const parsed = parseArgs({
  options: {
    once: { type: "boolean", default: false },
  },
  strict: true,
});

async function main(): Promise<number> {
  const [{ getEmailConfig }, { runEmailProviderEventConsumer }, cli] =
    await Promise.all([
      import("@/lib/email/config"),
      import("@/lib/email/provider-event-consumer"),
      import("@/lib/email/provider-event-consumer-cli"),
    ]);

  return cli.runProviderEventConsumerCli(
    {
      loadConfig: () => getEmailConfig().providerEventIngestion,
      run: ({ signal, once }) => runEmailProviderEventConsumer({ signal, once }),
      log: (level, event, data) => {
        const line = JSON.stringify({
          area: "email_provider_events",
          event,
          level,
          ...data,
        });
        if (level === "error") console.error(line);
        else if (level === "warn") console.warn(line);
        else console.log(line);
      },
      onShutdownSignal: (handler) => {
        process.once("SIGTERM", () => handler("SIGTERM"));
        process.once("SIGINT", () => handler("SIGINT"));
      },
    },
    { once: Boolean(parsed.values.once) },
  );
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch(async () => {
    const { EXIT_RETRYABLE } = await import(
      "@/lib/email/provider-event-consumer-cli"
    );
    console.error(
      JSON.stringify({
        area: "email_provider_events",
        event: "consumer_bootstrap_failed",
        level: "error",
      }),
    );
    process.exitCode = EXIT_RETRYABLE;
  });
