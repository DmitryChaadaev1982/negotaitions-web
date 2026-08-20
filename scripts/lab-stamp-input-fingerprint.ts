/**
 * Test-only: persist the canonical material fingerprint on a seeded Lab
 * AiAnalysis row. Playwright cannot import the Prisma analysis context builder.
 *
 * argv[2] = sessionId
 * argv[3] = match | mismatch
 */

export {};

async function main() {
  const e2eUrl = process.env.E2E_DATABASE_URL?.trim();
  if (!e2eUrl) {
    throw new Error("Lab fingerprint stamp requires E2E_DATABASE_URL");
  }
  process.env.DATABASE_URL = e2eUrl;

  const sessionId = process.argv[2]?.trim();
  const mode = process.argv[3]?.trim() === "mismatch" ? "mismatch" : "match";
  if (!sessionId) {
    throw new Error("Lab fingerprint stamp requires a sessionId");
  }

  const { prisma } = await import("../lib/prisma");
  const { fingerprintSessionAnalysisContext, buildSessionAnalysisContext } =
    await import("../lib/ai/session-analysis-context");

  const context = await buildSessionAnalysisContext(sessionId);
  if (!context) {
    throw new Error(`Session ${sessionId} not found for fingerprint stamp`);
  }
  const fingerprint = fingerprintSessionAnalysisContext(context);
  const stored =
    mode === "mismatch"
      ? fingerprint.replace(/[0-9a-f]/, (char) => (char === "0" ? "1" : "0"))
      : fingerprint;

  await prisma.aiAnalysis.update({
    where: { sessionId },
    data: { inputFingerprint: stored },
  });

  process.stdout.write(
    `${JSON.stringify({ sessionId, mode, storedFingerprint: stored })}\n`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
