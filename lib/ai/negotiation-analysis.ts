import OpenAI from "openai";
import { z } from "zod";

export function getAiAnalysisModel(): string {
  return process.env.AI_ANALYSIS_MODEL?.trim() || "gpt-4o-mini";
}

export function isOpenAiConfiguredForAnalysis(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
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

// ── OpenAI call ────────────────────────────────────────────────────────────

export async function runNegotiationAnalysis(
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
