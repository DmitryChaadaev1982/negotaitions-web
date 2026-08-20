/**
 * Test-only controlled invalidation path for post-negotiation participant
 * note mutations. Uses the canonical publication revoke helper.
 */

export {};

async function main() {
  const e2eUrl = process.env.E2E_DATABASE_URL?.trim();
  if (!e2eUrl) {
    throw new Error("Lab material invalidation requires E2E_DATABASE_URL");
  }
  process.env.DATABASE_URL = e2eUrl;

  const sessionId = process.argv[2]?.trim();
  if (!sessionId) {
    throw new Error("Lab material invalidation requires a sessionId");
  }

  const { applyControlledMaterialInvalidation } = await import(
    "../lib/ai/material-input-invalidation"

  );
  const result = await applyControlledMaterialInvalidation(sessionId);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
