import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

type Decision = "import" | "exclude" | "n/a";

type Row = {
  model: string;
  count: number | null;
  decision: Decision;
  reason: string;
};

function buildClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

function hasProdGuard(url: string): boolean {
  return /negotaitions_prod/i.test(url);
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is missing in local environment");
  }
  if (hasProdGuard(dbUrl)) {
    throw new Error("Refusing to run inventory against production-like DATABASE_URL");
  }
  const prisma = buildClient(dbUrl);
  try {
    const rows: Row[] = [];

    const add = (model: string, count: number | null, decision: Decision, reason: string) => {
      rows.push({ model, count, decision, reason });
    };

    // Allowed import scope.
    add("User", await prisma.user.count(), "import", "core business identity");
    add("UserConsent", await prisma.userConsent.count(), "import", "legal consent history");
    add("NegotiationCase", await prisma.negotiationCase.count(), "import", "business case catalog");
    add("CaseRole", await prisma.caseRole.count(), "import", "case child records (FK -> NegotiationCase)");

    // Explicitly excluded runtime/session/event/reporting scope.
    add("TrainingEvent", await prisma.trainingEvent.count(), "exclude", "runtime event data");
    add("EventParticipant", await prisma.eventParticipant.count(), "exclude", "runtime participation data");
    add("EventInvite", await prisma.eventInvite.count(), "exclude", "runtime invite data");
    add("Session", await prisma.session.count(), "exclude", "runtime session data");
    add("SessionParticipant", await prisma.sessionParticipant.count(), "exclude", "runtime participant data");
    add("SessionInvite", await prisma.sessionInvite.count(), "exclude", "runtime invite data");
    add("SessionRole", await prisma.sessionRole.count(), "exclude", "session-scoped role artifacts");
    add("SessionPauseInterval", await prisma.sessionPauseInterval.count(), "exclude", "runtime timing artifacts");
    add("SessionParticipantAudioActivity", await prisma.sessionParticipantAudioActivity.count(), "exclude", "runtime voice activity artifacts");
    add("Recording", await prisma.recording.count(), "exclude", "media recording artifacts");
    add("Transcript", await prisma.transcript.count(), "exclude", "transcription artifacts");
    add("TranscriptSegment", await prisma.transcriptSegment.count(), "exclude", "transcription artifacts");
    add("AiAnalysis", await prisma.aiAnalysis.count(), "exclude", "AI-generated reports");
    add("ExternalServiceEvent", await prisma.externalServiceEvent.count(), "exclude", "operational runtime logs");
    add("UsageCounter", await prisma.usageCounter.count(), "exclude", "operational metrics");
    add("AdminActionLog", await prisma.adminActionLog.count(), "exclude", "admin audit/runtime data");
    add("UserSession", await prisma.userSession.count(), "exclude", "auth runtime sessions");

    const header = ["Model", "Count", "Import decision", "Reason"];
    console.log(header.join(" | "));
    console.log("---|---:|---|---");
    for (const row of rows) {
      console.log(`${row.model} | ${row.count ?? "n/a"} | ${row.decision} | ${row.reason}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[inventory-error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
