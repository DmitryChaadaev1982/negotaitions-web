import OpenAI from "openai";
import { z } from "zod";
import { getAiAnalysisProvider, isYandexAiConfigured } from "@/lib/env";
import type { AnalysisProvider } from "@/lib/services/provider-interfaces";

export function getAiAnalysisModel(): string {
  return process.env.AI_ANALYSIS_MODEL?.trim() || "gpt-4o-mini";
}

export function isOpenAiConfiguredForAnalysis(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getYandexAiModel(): string {
  return process.env.YANDEX_AI_MODEL?.trim() || "deepseek-v4-flash";
}

export function getYandexAiMaxOutputTokens(): number {
  const raw = Number.parseInt(
    process.env.YANDEX_AI_MAX_OUTPUT_TOKENS?.trim() || "6000",
    10,
  );
  if (!Number.isFinite(raw)) {
    return 6000;
  }
  return Math.max(4000, raw);
}

export function isAiAnalysisConfiguredForSelectedProvider(): boolean {
  const provider = getAiAnalysisProvider();
  if (provider === "yandex") {
    return isYandexAiConfigured();
  }
  return isOpenAiConfiguredForAnalysis();
}

// ── Output schema ──────────────────────────────────────────────────────────

const EvidenceQualityLevel = z.enum(["LOW", "MEDIUM", "HIGH"]);

const ScoresSchema = z.object({
  preparation: z.number().int().min(0).max(100),
  structure: z.number().int().min(0).max(100),
  questionQuality: z.number().int().min(0).max(100),
  activeListening: z.number().int().min(0).max(100),
  argumentation: z.number().int().min(0).max(100),
  objectionHandling: z.number().int().min(0).max(100),
  emotionalControl: z.number().int().min(0).max(100),
  valueCreation: z.number().int().min(0).max(100),
  closing: z.number().int().min(0).max(100),
});

const RoleObjectiveAnalysisSchema = z.object({
  participantName: z.string(),
  roleName: z.string(),
  objectiveProgress: z.string(),
  evidence: z.string(),
  score: z.number().int().min(0).max(100),
});

const StrengthSchema = z.object({
  title: z.string(),
  evidence: z.string(),
  whyItMatters: z.string(),
  recommendation: z.string(),
});

const ImprovementAreaSchema = z.object({
  title: z.string(),
  evidence: z.string(),
  risk: z.string(),
  recommendation: z.string(),
  practiceExercise: z.string(),
});

const DetectedTacticSchema = z.object({
  name: z.string(),
  usedBy: z.string(),
  evidence: z.string(),
  effectiveness: z.string(),
  counterMove: z.string(),
});

const GoodQuestionSchema = z.object({
  question: z.string(),
  usedBy: z.string(),
  whyGood: z.string(),
});

const MissedQuestionSchema = z.object({
  suggestedQuestion: z.string(),
  whyItMattered: z.string(),
});

const QuestionsAnalysisSchema = z.object({
  goodQuestions: z.array(GoodQuestionSchema),
  missedQuestions: z.array(MissedQuestionSchema),
  diagnosticQualityComment: z.string(),
});

const ListeningAndReframingSchema = z.object({
  goodExamples: z.array(z.string()),
  missedOpportunities: z.array(z.string()),
  comment: z.string(),
});

const ValueCreationAnalysisSchema = z.object({
  createdOptions: z.array(z.string()),
  missedOptions: z.array(z.string()),
  tradeOffsDiscussed: z.array(z.string()),
  comment: z.string(),
});

const NextTrainingFocusSchema = z.object({
  focusArea: z.string(),
  why: z.string(),
  exercise: z.string(),
});

const OneMinuteFeedbackSchema = z.object({
  summary: z.string(),
  whatWorked: z.string(),
  whatToImprove: z.string(),
  nextStep: z.string(),
});

const ParticipantPersonalFeedbackSchema = z.object({
  participantName: z.string(),
  achievements: z.array(z.string()),
  couldHaveDoneBetter: z.array(z.string()),
  keyMoments: z.array(z.string()),
  nextSteps: z.array(z.string()),
});

export type ParticipantPersonalFeedback = z.infer<
  typeof ParticipantPersonalFeedbackSchema
>;

export const NegotiationAnalysisOutputSchema = z.object({
  executiveSummary: z.string(),
  overallScore: z.number().int().min(0).max(100),
  confidenceLevel: EvidenceQualityLevel,
  evidenceQuality: z.object({
    transcriptQuality: EvidenceQualityLevel,
    speakerAttributionQuality: EvidenceQualityLevel,
    notesQuality: EvidenceQualityLevel,
    comment: z.string(),
  }),
  scores: ScoresSchema,
  roleObjectivesAnalysis: z.array(RoleObjectiveAnalysisSchema),
  strengths: z.array(StrengthSchema),
  improvementAreas: z.array(ImprovementAreaSchema),
  detectedTactics: z.array(DetectedTacticSchema),
  questionsAnalysis: QuestionsAnalysisSchema,
  listeningAndReframing: ListeningAndReframingSchema,
  valueCreationAnalysis: ValueCreationAnalysisSchema,
  nextTrainingFocus: z.array(NextTrainingFocusSchema),
  facilitatorDebriefQuestions: z.array(z.string()),
  oneMinuteFeedback: OneMinuteFeedbackSchema,
  participantPersonalFeedback: z.array(ParticipantPersonalFeedbackSchema),
});

export type NegotiationAnalysisOutput = z.infer<
  typeof NegotiationAnalysisOutputSchema
>;

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert negotiation training coach for NegotAItions, an AI-powered negotiation training platform. Your task is to analyze a negotiation session and provide a comprehensive, evidence-based assessment.

CRITICAL RULES:
1. Only reference facts, quotes, and events from the provided transcript and notes.
2. If the transcript is short or evidence is sparse, give conservative scores and explicitly note insufficient evidence.
3. If speaker attribution is missing, set confidenceLevel to "LOW".
4. Never hallucinate timestamps, quotes, or events.
5. Scores MUST be integers 0-100. An average negotiator scores 40-60.
6. You MUST respond with valid JSON only, matching the exact schema provided. No explanation text outside JSON.`;

const YANDEX_COACHING_REQUIREMENTS = `
Depth and coaching quality requirements:
- Do not retell transcript. Evaluate negotiation quality and learning value.
- Separate deal outcome from process quality.
- Assess each participant relative to their role goals, constraints, and leverage.
- Explicitly indicate who captured better position and why.
- Use evidence: quote/paraphrase/missing behavior signals.
- Keep advice behaviorally concrete ("say/do X next time"), not generic.
- If transcript is short, mark confidence limits precisely but still provide complete structured analysis.

Section quality targets:
- executiveSummary: Russian 4-7 sentences, evaluative verdict, not a recap.
- strengths: 2-4 items with evidence + why it mattered + how to scale.
- improvementAreas: 3-5 items, each with evidence + risk + recommendation + micro-exercise.
- detectedTactics: 2-5 items; include effectiveness and counter-tactic; if weak evidence, mark as partial.
- questionsAnalysis.missedQuestions: include why it mattered, which role should ask, and what answer would change.
- listeningAndReframing.missedOpportunities: provide improved phrase and why it works.
- valueCreationAnalysis: distinguish value claimed vs created vs left on table via arrays/comment.
- nextTrainingFocus: 2-4 prioritized focuses; each exercise must include measurable success criterion and next negotiation application in text.
- facilitatorDebriefQuestions: 4-6 sharp, facilitator-grade questions.
- participantPersonalFeedback: role-specific, actionable; include one phrase to try next time and one risk to avoid in nextSteps/couldHaveDoneBetter text.

JSON constraints:
- strict JSON only, no markdown fences, no comments, no trailing commas.
- include all required fields; when uncertain use cautious wording or empty arrays.`;

// ── Mock response ──────────────────────────────────────────────────────────

export function createMockAnalysisOutput(language: string): NegotiationAnalysisOutput {
  const isRu = language === "ru" || language === "RU";
  return {
    executiveSummary: isRu
      ? "Это демонстрационный AI-разбор для тестирования системы NegotAItions. Реальный разбор будет содержать детальный анализ переговоров."
      : "This is a mock AI analysis for NegotAItions system testing. A real analysis will contain detailed negotiation feedback.",
    overallScore: 72,
    confidenceLevel: "HIGH",
    evidenceQuality: {
      transcriptQuality: "HIGH",
      speakerAttributionQuality: "MEDIUM",
      notesQuality: "LOW",
      comment: isRu
        ? "Транскрипт доступен. Атрибуция спикеров частичная."
        : "Transcript available. Speaker attribution is partial.",
    },
    scores: {
      preparation: 75,
      structure: 70,
      questionQuality: 68,
      activeListening: 72,
      argumentation: 74,
      objectionHandling: 65,
      emotionalControl: 80,
      valueCreation: 60,
      closing: 70,
    },
    roleObjectivesAnalysis: [
      {
        participantName: "Participant A",
        roleName: "Buyer",
        objectiveProgress: isRu
          ? "Покупатель достиг основной цели по цене."
          : "Buyer achieved the primary price objective.",
        evidence: isRu
          ? "В транскрипте зафиксировано согласование цены."
          : "Price agreement was documented in the transcript.",
        score: 72,
      },
    ],
    strengths: [
      {
        title: isRu ? "Активное слушание" : "Active listening",
        evidence: isRu
          ? "Участник перефразировал ключевые позиции собеседника."
          : "Participant paraphrased key positions of the counterpart.",
        whyItMatters: isRu
          ? "Активное слушание повышает доверие и снижает напряжение."
          : "Active listening builds trust and reduces tension.",
        recommendation: isRu
          ? "Продолжайте использовать эту технику в сложных переговорах."
          : "Continue using this technique in challenging negotiations.",
      },
    ],
    improvementAreas: [
      {
        title: isRu ? "Создание ценности" : "Value creation",
        evidence: isRu
          ? "Мало предложений по расширению пирога переговоров."
          : "Few proposals to expand the negotiation pie.",
        risk: isRu
          ? "Риск распределительного торга без совместных выгод."
          : "Risk of distributive bargaining without joint gains.",
        recommendation: isRu
          ? "Исследуйте интересы партнёра активнее."
          : "Explore counterpart interests more actively.",
        practiceExercise: isRu
          ? "Упражнение: назовите 3 возможных варианта обмена ценностями."
          : "Exercise: name 3 possible value-trade options.",
      },
    ],
    detectedTactics: [
      {
        name: isRu ? "Якорение" : "Anchoring",
        usedBy: "Participant A",
        evidence: isRu
          ? "Первое предложение задало ценовой якорь."
          : "Opening offer set a price anchor.",
        effectiveness: isRu ? "Высокая" : "High",
        counterMove: isRu
          ? "Переформулируйте ситуацию, игнорируя первоначальный якорь."
          : "Reframe the situation, ignoring the initial anchor.",
      },
    ],
    questionsAnalysis: {
      goodQuestions: [
        {
          question: isRu
            ? "Каковы ваши ключевые приоритеты в этой сделке?"
            : "What are your key priorities in this deal?",
          usedBy: "Participant B",
          whyGood: isRu
            ? "Открытый вопрос, раскрывающий интересы."
            : "Open question revealing interests.",
        },
      ],
      missedQuestions: [
        {
          suggestedQuestion: isRu
            ? "Что мешает вам принять это предложение прямо сейчас?"
            : "What prevents you from accepting this offer right now?",
          whyItMattered: isRu
            ? "Выявило бы скрытые возражения."
            : "Would have revealed hidden objections.",
        },
      ],
      diagnosticQualityComment: isRu
        ? "Качество вопросов выше среднего. Есть пространство для диагностических вопросов."
        : "Question quality is above average. Room for more diagnostic questions.",
    },
    listeningAndReframing: {
      goodExamples: [
        isRu
          ? "Участник A подтвердил понимание позиции партнёра."
          : "Participant A confirmed understanding of the counterpart's position.",
      ],
      missedOpportunities: [
        isRu
          ? "Можно было переформулировать возражение как возможность."
          : "An objection could have been reframed as an opportunity.",
      ],
      comment: isRu
        ? "Слушание активное, но переосмысление используется редко."
        : "Listening is active but reframing is rarely used.",
    },
    valueCreationAnalysis: {
      createdOptions: [
        isRu ? "Предложен отложенный платёж." : "Deferred payment proposed.",
      ],
      missedOptions: [
        isRu ? "Не обсуждались опции сервисного обслуживания." : "Service options were not discussed.",
      ],
      tradeOffsDiscussed: [
        isRu ? "Цена и объём обсуждались совместно." : "Price and volume were discussed jointly.",
      ],
      comment: isRu
        ? "Создание ценности ограничено. Фокус на цене, а не на взаимных интересах."
        : "Value creation is limited. Focus was on price rather than mutual interests.",
    },
    nextTrainingFocus: [
      {
        focusArea: isRu ? "Создание ценности" : "Value creation",
        why: isRu
          ? "Переговоры были преимущественно распределительными."
          : "Negotiations were predominantly distributive.",
        exercise: isRu
          ? "Практикуйте техники обмена ценностями в ролевых играх."
          : "Practice value-trading techniques in role-plays.",
      },
    ],
    facilitatorDebriefQuestions: [
      isRu
        ? "Какой момент в переговорах был самым сложным? Почему?"
        : "What was the most challenging moment in the negotiation? Why?",
      isRu
        ? "Как бы вы поступили иначе, зная результат?"
        : "What would you do differently knowing the outcome?",
      isRu
        ? "Какую ценность вы оставили на столе переговоров?"
        : "What value did you leave on the table?",
    ],
    oneMinuteFeedback: {
      summary: isRu
        ? "Переговоры прошли структурированно, с активным слушанием, но с ограниченным созданием ценности."
        : "The negotiation was structured and active listening was present, but value creation was limited.",
      whatWorked: isRu
        ? "Хорошее управление темпом и активное слушание."
        : "Good pacing and active listening.",
      whatToImprove: isRu
        ? "Больше диагностических вопросов и создание ценности."
        : "More diagnostic questions and value creation.",
      nextStep: isRu
        ? "Попрактикуйтесь в обмене ценностями на следующей сессии."
        : "Practice value trading in the next session.",
    },
    participantPersonalFeedback: [
      {
        participantName: "Participant A",
        achievements: isRu
          ? [
              "Уверенно использовал технику якорения с первого хода.",
              "Сохранял спокойствие под давлением и не шёл на уступки без взаимного обмена.",
            ]
          : [
              "Confidently used anchoring technique from the first move.",
              "Remained calm under pressure and did not concede without reciprocal exchange.",
            ],
        couldHaveDoneBetter: isRu
          ? [
              "Мало задавал открытых вопросов для выяснения интересов партнёра.",
              "Не исследовал возможности расширения пирога переговоров.",
            ]
          : [
              "Asked too few open questions to explore the counterpart's interests.",
              "Did not explore options for expanding the negotiation pie.",
            ],
        keyMoments: isRu
          ? [
              "Первое предложение создало сильный ценовой якорь и задало тон переговорам.",
              "Момент, когда партнёр поднял возражение по срокам — была возможность раскрыть скрытые интересы.",
            ]
          : [
              "The opening offer created a strong price anchor and set the tone for the negotiation.",
              "When the counterpart raised an objection about timing — there was an opportunity to uncover hidden interests.",
            ],
        nextSteps: isRu
          ? [
              "Потренируйтесь задавать 3–5 диагностических вопросов до выдвижения своего предложения.",
              "На следующей сессии попробуйте предложить пакетный вариант с несколькими переменными.",
            ]
          : [
              "Practice asking 3–5 diagnostic questions before making your offer.",
              "In the next session, try proposing a package deal with multiple variables.",
            ],
      },
      {
        participantName: "Participant B",
        achievements: isRu
          ? [
              "Активно слушал и перефразировал позиции партнёра, что снижало напряжение.",
              "Эффективно использовал паузы для обдумывания ответов.",
            ]
          : [
              "Actively listened and paraphrased the counterpart's positions, reducing tension.",
              "Effectively used pauses to think through responses.",
            ],
        couldHaveDoneBetter: isRu
          ? [
              "Слишком быстро шёл на уступки без достаточных условий.",
              "Не использовал собственную НАОС как рычаг давления.",
            ]
          : [
              "Conceded too quickly without sufficient conditions.",
              "Did not use their own BATNA as a source of leverage.",
            ],
        keyMoments: isRu
          ? [
              "Момент встречного предложения — можно было добавить условия, а не просто снизить цену.",
              "Когда партнёр молчал — это была возможность задать уточняющий вопрос, а не заполнять паузу уступкой.",
            ]
          : [
              "The counter-offer moment — conditions could have been added rather than simply lowering the price.",
              "When the counterpart went silent — it was an opportunity to ask a clarifying question rather than fill the pause with a concession.",
            ],
        nextSteps: isRu
          ? [
              "Перед следующей сессией пропишите свою НАОС и определите линию ухода.",
              "Попрактикуйтесь делать условные уступки: «Я готов на X, если вы согласитесь на Y».",
            ]
          : [
              "Before the next session, write down your BATNA and define your walk-away point.",
              "Practice conditional concessions: 'I'm willing to do X if you agree to Y'.",
            ],
      },
    ],
  };
}

// ── Analysis providers ─────────────────────────────────────────────────────

async function runOpenAiNegotiationAnalysis(
  prompt: string,
  language: string,
): Promise<{ output: NegotiationAnalysisOutput; rawOutput: unknown; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OpenAI API key is missing.");
  }

  const client = new OpenAI({ apiKey });
  const model = getAiAnalysisModel();
  const langInstruction =
    language === "ru" || language === "RU"
      ? "Respond in Russian language."
      : "Respond in English language.";

  const schemaDescription = `Respond with a JSON object matching this TypeScript type exactly:
{
  executiveSummary: string;
  overallScore: number; // 0-100 integer
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  evidenceQuality: { transcriptQuality: "LOW"|"MEDIUM"|"HIGH"; speakerAttributionQuality: "LOW"|"MEDIUM"|"HIGH"; notesQuality: "LOW"|"MEDIUM"|"HIGH"; comment: string; };
  scores: { preparation: number; structure: number; questionQuality: number; activeListening: number; argumentation: number; objectionHandling: number; emotionalControl: number; valueCreation: number; closing: number; }; // all 0-100 integers
  roleObjectivesAnalysis: Array<{ participantName: string; roleName: string; objectiveProgress: string; evidence: string; score: number; }>;
  strengths: Array<{ title: string; evidence: string; whyItMatters: string; recommendation: string; }>;
  improvementAreas: Array<{ title: string; evidence: string; risk: string; recommendation: string; practiceExercise: string; }>;
  detectedTactics: Array<{ name: string; usedBy: string; evidence: string; effectiveness: string; counterMove: string; }>;
  questionsAnalysis: { goodQuestions: Array<{ question: string; usedBy: string; whyGood: string; }>; missedQuestions: Array<{ suggestedQuestion: string; whyItMattered: string; }>; diagnosticQualityComment: string; };
  listeningAndReframing: { goodExamples: string[]; missedOpportunities: string[]; comment: string; };
  valueCreationAnalysis: { createdOptions: string[]; missedOptions: string[]; tradeOffsDiscussed: string[]; comment: string; };
  nextTrainingFocus: Array<{ focusArea: string; why: string; exercise: string; }>;
  facilitatorDebriefQuestions: string[];
  oneMinuteFeedback: { summary: string; whatWorked: string; whatToImprove: string; nextStep: string; };
  participantPersonalFeedback: Array<{
    participantName: string; // exact name of the negotiating participant (not facilitator/observer)
    achievements: string[]; // 2-4 specific things this participant did well, with evidence
    couldHaveDoneBetter: string[]; // 2-4 specific areas where this participant underperformed, with evidence and concrete improvement tips
    keyMoments: string[]; // 2-3 key moments that were decisive for this participant (good or missed)
    nextSteps: string[]; // 2-3 personalized, actionable next steps for this participant's development
  }>; // one entry per negotiating participant (exclude facilitators and observers)
}`;

  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}\n\n${langInstruction}\n\n${schemaDescription}`,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const rawContent = completion.choices[0]?.message?.content ?? "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(`AI returned non-JSON response: ${rawContent.slice(0, 200)}`);
  }

  const validated = NegotiationAnalysisOutputSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`AI response failed schema validation: ${issues}`);
  }

  return {
    output: validated.data,
    rawOutput: parsed,
    model: completion.model ?? model,
  };
}

function stripMarkdownJsonFences(input: string): {
  cleaned: string;
  fencesRemoved: boolean;
} {
  const trimmed = input.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (!fenced) {
    return { cleaned: trimmed, fencesRemoved: false };
  }
  return { cleaned: fenced[1].trim(), fencesRemoved: true };
}

function stripTrailingCommas(input: string): string {
  return input.replace(/,\s*([}\]])/g, "$1");
}

function extractFirstBalancedJsonObject(input: string): string | null {
  const source = input.trim();
  const startIndex = source.indexOf("{");
  if (startIndex < 0) {
    return null;
  }

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function looksPossiblyTruncatedJson(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }
  return (
    trimmed.endsWith(":") ||
    trimmed.endsWith(",") ||
    !trimmed.endsWith("}") ||
    trimmed.split("{").length > trimmed.split("}").length
  );
}

function tryParseJsonWithRecovery(input: string): unknown | null {
  const attempts = [input, stripTrailingCommas(input)];
  const firstBalanced = extractFirstBalancedJsonObject(input);
  if (firstBalanced) {
    attempts.push(firstBalanced, stripTrailingCommas(firstBalanced));
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }
  return null;
}

function countSentences(input: string): number {
  return input
    .split(/[.!?]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean).length;
}

function assessAnalysisDepth(output: NegotiationAnalysisOutput): string[] {
  const issues: string[] = [];

  const summarySentences = countSentences(output.executiveSummary);
  if (summarySentences < 4) {
    issues.push("executiveSummary should contain at least 4 evaluative sentences.");
  }
  if (summarySentences > 7) {
    issues.push("executiveSummary should be concise: no more than 7 sentences.");
  }
  if (output.strengths.length < 2) {
    issues.push("strengths should include at least 2 evidence-based items.");
  }
  if (output.improvementAreas.length < 3) {
    issues.push("improvementAreas should include at least 3 actionable items.");
  }
  if (output.detectedTactics.length < 2) {
    issues.push("detectedTactics should include at least 2 tactics with counter-moves.");
  }
  if (output.nextTrainingFocus.length < 2 || output.nextTrainingFocus.length > 4) {
    issues.push("nextTrainingFocus should contain 2-4 prioritized focuses.");
  }
  if (
    output.facilitatorDebriefQuestions.length < 4 ||
    output.facilitatorDebriefQuestions.length > 6
  ) {
    issues.push("facilitatorDebriefQuestions should contain 4-6 sharp questions.");
  }
  if (output.participantPersonalFeedback.length === 0) {
    issues.push("participantPersonalFeedback should include role-specific feedback entries.");
  }

  return issues;
}

function extractYandexOutputText(payload: Record<string, unknown>): string {
  const outputText = payload.output_text;
  if (typeof outputText === "string" && outputText.trim().length > 0) {
    return outputText;
  }

  const output = payload.output;
  if (!Array.isArray(output)) {
    return "";
  }

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim().length > 0) {
        chunks.push(text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function runYandexNegotiationAnalysis(
  prompt: string,
  language: string,
): Promise<{ output: NegotiationAnalysisOutput; rawOutput: unknown; model: string }> {
  const folderId = process.env.YANDEX_FOLDER_ID?.trim();
  const apiKey = process.env.YANDEX_API_KEY?.trim();
  if (!folderId || !apiKey) {
    throw new Error("Yandex AI configuration is missing.");
  }
  const safeFolderId = folderId;
  const safeApiKey = apiKey;

  const modelName = getYandexAiModel();
  const modelUri = `gpt://${safeFolderId}/${modelName}`;
  const maxOutputTokens = getYandexAiMaxOutputTokens();
  const baseUrl = (
    process.env.YANDEX_AI_BASE_URL?.trim() || "https://ai.api.cloud.yandex.net/v1"
  ).replace(/\/$/, "");
  const langInstruction =
    language === "ru" || language === "RU"
      ? "Respond in Russian language."
      : "Respond in English language.";

  const schemaDescription = `Respond with a JSON object matching this TypeScript type exactly:
{
  executiveSummary: string;
  overallScore: number; // integer 0-100 for negotiation skill quality, not just deal reached
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  evidenceQuality: { transcriptQuality: "LOW"|"MEDIUM"|"HIGH"; speakerAttributionQuality: "LOW"|"MEDIUM"|"HIGH"; notesQuality: "LOW"|"MEDIUM"|"HIGH"; comment: string; }; // explain reliability and limits specifically
  scores: { preparation: number; structure: number; questionQuality: number; activeListening: number; argumentation: number; objectionHandling: number; emotionalControl: number; valueCreation: number; closing: number; };
  roleObjectivesAnalysis: Array<{ participantName: string; roleName: string; objectiveProgress: string; evidence: string; score: number; }>; // include leverage used/missed and concession quality in objectiveProgress/evidence text
  strengths: Array<{ title: string; evidence: string; whyItMatters: string; recommendation: string; }>;
  improvementAreas: Array<{ title: string; evidence: string; risk: string; recommendation: string; practiceExercise: string; }>;
  detectedTactics: Array<{ name: string; usedBy: string; evidence: string; effectiveness: string; counterMove: string; }>; // include tactic risk in effectiveness/counterMove text
  questionsAnalysis: { goodQuestions: Array<{ question: string; usedBy: string; whyGood: string; }>; missedQuestions: Array<{ suggestedQuestion: string; whyItMattered: string; }>; diagnosticQualityComment: string; }; // missed question text must specify role + what answer would change
  listeningAndReframing: { goodExamples: string[]; missedOpportunities: string[]; comment: string; }; // missed opportunities should include improved phrase + why it works
  valueCreationAnalysis: { createdOptions: string[]; missedOptions: string[]; tradeOffsDiscussed: string[]; comment: string; }; // separate created value vs left on table in arrays/comment
  nextTrainingFocus: Array<{ focusArea: string; why: string; exercise: string; }>; // exercise text must include success criterion and next negotiation application
  facilitatorDebriefQuestions: string[]; // 4-6 facilitator-grade questions
  oneMinuteFeedback: { summary: string; whatWorked: string; whatToImprove: string; nextStep: string; }; // concise coach-style
  participantPersonalFeedback: Array<{ participantName: string; achievements: string[]; couldHaveDoneBetter: string[]; keyMoments: string[]; nextSteps: string[]; }>; // role-specific, actionable
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  try {
    async function requestModelOutput(
      tokenLimit: number,
      compactJsonMode = false,
      depthRetryReason = "",
    ): Promise<{ envelope: Record<string, unknown>; cleaned: string }> {
      const compactInstruction = compactJsonMode
        ? "\n\nOutput constraints: return strict minified JSON only, no markdown, no comments, no trailing commas, concise strings."
        : "";
      const depthInstruction = depthRetryReason
        ? `\n\nYour previous output was too shallow. Fix these quality gaps while keeping strict JSON schema:\n- ${depthRetryReason}`
        : "";

      const response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Api-Key ${safeApiKey}`,
          "Content-Type": "application/json",
          "x-folder-id": safeFolderId,
          "x-data-logging-enabled": "false",
        },
        body: JSON.stringify({
          model: modelUri,
          temperature: 0.2,
          max_output_tokens: tokenLimit,
          instructions: `${SYSTEM_PROMPT}\n\n${langInstruction}\n\n${YANDEX_COACHING_REQUIREMENTS}\n\n${schemaDescription}${compactInstruction}${depthInstruction}`,
          input: prompt,
        }),
      });

      const rawResponseText = await response.text();
      if (!response.ok) {
        throw new Error(
          `Yandex AI request failed with HTTP ${response.status}: ${rawResponseText.slice(0, 300)}`,
        );
      }

      let envelope: Record<string, unknown>;
      try {
        envelope = JSON.parse(rawResponseText) as Record<string, unknown>;
      } catch {
        throw new Error(
          `Yandex AI analysis failed: non-JSON envelope (model=${modelName}, responseLength=${rawResponseText.length}).`,
        );
      }

      const modelText = extractYandexOutputText(envelope);
      if (!modelText) {
        throw new Error(
          `Yandex AI analysis failed: empty model output (model=${modelName}, responseLength=0).`,
        );
      }

      const { cleaned, fencesRemoved } = stripMarkdownJsonFences(modelText);
      if (fencesRemoved) {
        console.warn("[AI analysis] Yandex response required markdown fence cleanup.");
      }

      return { envelope, cleaned };
    }

    let requestResult = await requestModelOutput(maxOutputTokens, false);
    let parsed = tryParseJsonWithRecovery(requestResult.cleaned);

    if (!parsed && looksPossiblyTruncatedJson(requestResult.cleaned)) {
      const retryTokens = Math.max(maxOutputTokens, 6500);
      console.warn(
        `[AI analysis] Retrying Yandex analysis with compact JSON mode (model=${modelName}, max_output_tokens=${retryTokens}).`,
      );
      requestResult = await requestModelOutput(retryTokens, true);
      parsed = tryParseJsonWithRecovery(requestResult.cleaned);
    }

    if (!parsed) {
      const responseLength = requestResult.cleaned.length;
      const kind = looksPossiblyTruncatedJson(requestResult.cleaned)
        ? "truncated/invalid JSON"
        : "invalid JSON";
      const message = `Yandex AI analysis failed: ${kind} (model=${modelName}, responseLength=${responseLength}).`;
      console.error(`[AI analysis] ${message}`);
      throw new Error(message);
    }

    const validated = NegotiationAnalysisOutputSchema.safeParse(parsed);
    if (!validated.success) {
      const issues = validated.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`AI response failed schema validation: ${issues}`);
    }

    let selectedOutput = validated.data;
    const depthIssues = assessAnalysisDepth(selectedOutput);
    if (depthIssues.length > 0) {
      const retryTokens = Math.max(maxOutputTokens, 7000);
      console.warn(
        `[AI analysis] Retrying Yandex analysis for deeper coaching output (model=${modelName}, issues=${depthIssues.length}).`,
      );
      const depthRetry = await requestModelOutput(
        retryTokens,
        false,
        depthIssues.slice(0, 6).join("\n- "),
      );
      const reparsed = tryParseJsonWithRecovery(depthRetry.cleaned);
      if (reparsed) {
        const revalidated = NegotiationAnalysisOutputSchema.safeParse(reparsed);
        if (revalidated.success) {
          selectedOutput = revalidated.data;
          requestResult = depthRetry;
        }
      }
    }

    return {
      output: selectedOutput,
      rawOutput: requestResult.envelope,
      model: modelName,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Yandex API network timeout. Check VPN split tunneling.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runNegotiationAnalysis(
  prompt: string,
  language: string,
): Promise<{ output: NegotiationAnalysisOutput; rawOutput: unknown; model: string }> {
  const provider = getAiAnalysisProvider();
  const providers: Record<"openai" | "yandex", AnalysisProvider> = {
    openai: { run: runOpenAiNegotiationAnalysis },
    yandex: { run: runYandexNegotiationAnalysis },
  };
  return providers[provider].run(prompt, language);
}
