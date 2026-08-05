import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [{ parseEmailCanaryArguments }, { runOneMessageEmailCanary }] =
    await Promise.all([
      import("@/lib/email/operational-cli"),
      import("@/lib/email/canary"),
    ]);
  const parsed = parseEmailCanaryArguments(process.argv.slice(2));
  const result = await runOneMessageEmailCanary({
    messageId: parsed.messageId,
  });
  console.log(JSON.stringify({ ok: true, ...result }));
}

void main().catch((error: unknown) => {
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "EMAIL_CANARY_FAILED";
  console.error(JSON.stringify({ ok: false, code }));
  process.exitCode = 1;
});
