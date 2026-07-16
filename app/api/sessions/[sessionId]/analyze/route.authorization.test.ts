import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("analyze route keeps authorization guards after service extraction", async () => {
  const filePath = join(
    process.cwd(),
    "app/api/sessions/[sessionId]/analyze/route.ts",
  );
  const source = await readFile(filePath, "utf8");

  assert.equal(source.includes("resolveRoomParticipantFromParsedBody"), true);
  assert.equal(source.includes("getOptionalCurrentUser"), true);
  assert.equal(source.includes("isAdmin"), true);
  assert.equal(
    source.includes("participant.type !== ParticipantType.FACILITATOR"),
    true,
  );
  assert.equal(source.includes('return NextResponse.json({ error: "Forbidden." }'), true);
});
