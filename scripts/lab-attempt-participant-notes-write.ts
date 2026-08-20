/**
 * Test-only attempt to persist notes through the same helper used by
 * saveAccountParticipantNotes / saveParticipantNotes.
 */

export {};

async function main() {
  const e2eUrl = process.env.E2E_DATABASE_URL?.trim();
  if (!e2eUrl) {
    throw new Error("Lab notes write requires E2E_DATABASE_URL");
  }
  process.env.DATABASE_URL = e2eUrl;

  const participantId = process.argv[2]?.trim();
  const notes = process.argv[3] ?? "lab attempted participant notes write";
  if (!participantId) {
    throw new Error("Lab notes write requires a participantId");
  }

  const { persistParticipantNotesAfterAccess } = await import(
    "../lib/participant-notes-write"
  );
  const result = await persistParticipantNotesAfterAccess({
    participantId,
    notes,
    enforceUnassignedParticipantLock: true,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 2);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
