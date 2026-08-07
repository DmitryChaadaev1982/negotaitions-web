import { bootstrapOperationalEnv } from "@/lib/operational-env";

bootstrapOperationalEnv();

async function main(): Promise<void> {
  const { parsePasswordResetQuarantineArguments } = await import(
    "@/lib/email/operational-cli"
  );
  const { quarantineStalePasswordResetBacklog } = await import(
    "@/lib/email/password-reset-dispatch"
  );
  const parsed = parsePasswordResetQuarantineArguments(process.argv.slice(2));
  const result = await quarantineStalePasswordResetBacklog({
    apply: parsed.apply,
    limit: parsed.limit,
  });
  console.log(JSON.stringify({ ok: result.partialFailures === 0, ...result }));
  if (result.partialFailures > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "PASSWORD_RESET_QUARANTINE_FAILED";
  console.error(JSON.stringify({ ok: false, code }));
  process.exitCode = 1;
});
