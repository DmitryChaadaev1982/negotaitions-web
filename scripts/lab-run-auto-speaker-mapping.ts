/**
 * Test-only runner that executes the real production auto-speaker mapper
 * against the isolated E2E database. Playwright cannot resolve production
 * `@/` imports from its worker, so PIPELINE_FIXTURE invokes this process.
 */

export {};

async function main() {
  const e2eUrl = process.env.E2E_DATABASE_URL?.trim();
  if (!e2eUrl) {
    throw new Error("PIPELINE_FIXTURE requires E2E_DATABASE_URL");
  }
  process.env.DATABASE_URL = e2eUrl;

  const sessionId = process.argv[2]?.trim();
  if (!sessionId) {
    throw new Error("PIPELINE_FIXTURE requires a sessionId");
  }

  const { autoTriggerSpeakerMappingAfterTranscription } = await import(
    "../lib/transcription/auto-trigger-mapping"
  );

  const result = await autoTriggerSpeakerMappingAfterTranscription(sessionId);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
