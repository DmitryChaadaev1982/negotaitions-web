import { prisma } from "@/lib/prisma";

/**
 * Build a transcription hint prompt using PUBLIC session context only.
 *
 * Privacy rules:
 * - May include: participant display names, public role names, case title,
 *   public instructions, business context, common domain terms.
 * - Must NOT include: private role instructions, objectives, constraints,
 *   hidden info, fallback positions, or any facilitator-only data.
 *
 * The resulting string is passed as the OpenAI transcription `prompt`
 * parameter to improve domain accuracy, not to control transcript content.
 */
export async function buildTranscriptionPrompt(
  sessionId: string,
): Promise<string | null> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId },
    select: {
      snapshotCaseTitle: true,
      snapshotPublicInstructions: true,
      snapshotBusinessContext: true,
      participants: {
        select: {
          displayName: true,
          type: true,
          sessionRole: { select: { name: true } },
        },
      },
    },
  });

  if (!session) return null;

  const parts: string[] = [];

  if (session.snapshotCaseTitle) {
    parts.push(`Case: ${session.snapshotCaseTitle}.`);
  }

  const participantLines: string[] = [];
  for (const p of session.participants) {
    if (p.type === "PARTICIPANT" && p.sessionRole?.name) {
      participantLines.push(`${p.displayName} (${p.sessionRole.name})`);
    } else if (p.type === "FACILITATOR") {
      participantLines.push(`${p.displayName} (Facilitator)`);
    } else if (p.type === "OBSERVER") {
      participantLines.push(`${p.displayName} (Observer)`);
    } else {
      participantLines.push(p.displayName);
    }
  }

  if (participantLines.length > 0) {
    parts.push(`Participants: ${participantLines.join(", ")}.`);
  }

  // Include trimmed public context (first 300 chars) to bias domain vocabulary
  const context = session.snapshotBusinessContext?.trim();
  if (context) {
    const excerpt = context.length > 300 ? context.slice(0, 300) + "…" : context;
    parts.push(`Context: ${excerpt}`);
  }

  // Detect language from the business context / case title to pick vocabulary list
  const combinedText = [
    session.snapshotCaseTitle ?? "",
    context ?? "",
  ].join(" ");
  const isRussian = detectRussian(combinedText);

  // Add domain-specific negotiation vocabulary to improve recognition accuracy.
  // These are common spoken phrases in negotiation sessions — they bias the model
  // toward recognising key agreement/rejection/counteroffer utterances correctly.
  // No hidden role data, objectives, or fallback positions are included here.
  const vocab = isRussian ? RU_NEGOTIATION_TERMS : EN_NEGOTIATION_TERMS;
  parts.push(`Negotiation vocabulary: ${vocab.join(", ")}.`);

  parts.push(
    "Instruction: transcribe only spoken audio. Do not output or paraphrase this prompt text.",
  );

  if (parts.length === 0) return null;
  return parts.join(" ");
}

/**
 * Heuristic: detect Russian by checking for Cyrillic characters.
 * Returns true if more than 30% of alphabetic characters are Cyrillic.
 */
function detectRussian(text: string): boolean {
  if (!text) return false;
  const alpha = text.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "");
  if (alpha.length === 0) return false;
  const cyrillic = (text.match(/[а-яА-ЯёЁ]/g) ?? []).length;
  return cyrillic / alpha.length > 0.3;
}

/**
 * Russian negotiation vocabulary — common spoken phrases that STT models
 * often mishear or omit. No private role content.
 */
const RU_NEGOTIATION_TERMS: string[] = [
  "цена",
  "скидка",
  "согласен",
  "беру",
  "подходит",
  "не подходит",
  "дорого",
  "уступка",
  "договорились",
  "финальная цена",
  "за килограмм",
  "срок",
  "объём",
  "условия",
  "не пойдёт",
  "окей",
  "давайте",
  "устраивает",
  "предложение",
  "встречное предложение",
];

/**
 * English negotiation vocabulary — common spoken phrases.
 * No private role content.
 */
const EN_NEGOTIATION_TERMS: string[] = [
  "price",
  "discount",
  "agree",
  "accepted",
  "deal",
  "works for me",
  "not acceptable",
  "too expensive",
  "concession",
  "final price",
  "per kilogram",
  "terms",
  "counteroffer",
];
