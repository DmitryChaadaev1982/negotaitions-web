import OpenAI from "openai";
import { z } from "zod";
import { getAiAnalysisProvider, isYandexAiConfigured } from "@/lib/env";

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

export type AiAnalysisErrorCode =
  | "CONFIG_MISSING"
  | "NETWORK_TIMEOUT"
  | "NETWORK_ERROR"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_RATE_LIMIT"
  | "MODEL_EMPTY_OUTPUT"
  | "MODEL_INVALID_OUTPUT"
  | "MODEL_SCHEMA_VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "CANCELLED";

export type AiAnalysisProviderName = "openai" | "yandex";

export type AiAnalysisCallMetric = {
  attemptNumber: number;
  callNumber: number;
  purpose: "primary" | "compact_json_retry" | "depth_retry";
  model: string;
  durationMs: number;
  promptChars: number;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  responseLength: number;
  httpStatus: number | null;
  providerStatus: string | null;
  responseIdPresent: boolean;
  pollingAttemptCount: number;
  errorClass: AiAnalysisErrorCode | null;
};

export type AiAnalysisRunMetrics = {
  provider: AiAnalysisProviderName;
  model: string;
  totalDurationMs: number;
  promptChars: number;
  estimatedInputTokens: number;
  modelCallCount: number;
  retryCount: number;
  maxAttempts: number;
  timeoutMs: number;
  responseLength: number;
  outputChars: number;
  errorClass: AiAnalysisErrorCode | null;
  calls: AiAnalysisCallMetric[];
};

export class AiAnalysisProviderError extends Error {
  readonly code: AiAnalysisErrorCode;
  readonly provider: AiAnalysisProviderName;
  readonly model: string | null;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly diagnostics: Record<string, unknown>;
  metrics?: AiAnalysisRunMetrics;

  constructor(params: {
    code: AiAnalysisErrorCode;
    provider: AiAnalysisProviderName;
    message: string;
    userMessage?: string;
    model?: string | null;
    httpStatus?: number | null;
    retryable?: boolean;
    diagnostics?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });
    this.name = "AiAnalysisProviderError";
    this.code = params.code;
    this.provider = params.provider;
    this.model = params.model ?? null;
    this.httpStatus = params.httpStatus ?? null;
    this.retryable = params.retryable ?? false;
    this.userMessage = params.userMessage ?? defaultAiAnalysisUserMessage(params.code);
    this.diagnostics = params.diagnostics ?? {};
  }
}

function defaultAiAnalysisUserMessage(code: AiAnalysisErrorCode): string {
  switch (code) {
    case "CONFIG_MISSING":
      return "AI analysis provider is not configured.";
    case "NETWORK_TIMEOUT":
      return "AI provider timed out while generating analysis. Please retry.";
    case "NETWORK_ERROR":
      return "AI provider network request failed. Please retry.";
    case "PROVIDER_RATE_LIMIT":
      return "AI provider rate limit reached. Please try again later.";
    case "PROVIDER_HTTP_ERROR":
      return "AI provider returned an error. Please try again later.";
    case "MODEL_EMPTY_OUTPUT":
      return "AI provider returned an empty analysis. Please retry.";
    case "MODEL_INVALID_OUTPUT":
      return "AI provider returned an invalid analysis format. Please retry.";
    case "MODEL_SCHEMA_VALIDATION_ERROR":
      return "AI provider returned analysis that failed validation. Please retry.";
    case "CANCELLED":
      return "AI analysis was cancelled.";
    default:
      return "AI analysis failed. Please retry.";
  }
}

export function classifyAiAnalysisError(error: unknown): {
  code: AiAnalysisErrorCode;
  provider: AiAnalysisProviderName | null;
  model: string | null;
  httpStatus: number | null;
  retryable: boolean;
  userMessage: string;
  diagnostics: Record<string, unknown>;
  metrics?: AiAnalysisRunMetrics;
} {
  if (error instanceof AiAnalysisProviderError) {
    return {
      code: error.code,
      provider: error.provider,
      model: error.model,
      httpStatus: error.httpStatus,
      retryable: error.retryable,
      userMessage: error.userMessage,
      diagnostics: error.diagnostics,
      metrics: error.metrics,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const code: AiAnalysisErrorCode = lower.includes("configuration") || lower.includes("api key")
    ? "CONFIG_MISSING"
    : lower.includes("timeout") || lower.includes("timed out")
      ? "NETWORK_TIMEOUT"
      : lower.includes("schema validation")
        ? "MODEL_SCHEMA_VALIDATION_ERROR"
        : lower.includes("non-json") || lower.includes("invalid json")
          ? "MODEL_INVALID_OUTPUT"
          : lower.includes("empty model output")
            ? "MODEL_EMPTY_OUTPUT"
            : "INTERNAL_ERROR";

  return {
    code,
    provider: null,
    model: null,
    httpStatus: null,
    retryable: false,
    userMessage: defaultAiAnalysisUserMessage(code),
    diagnostics: {
      name: error instanceof Error ? error.name : "UnknownError",
      message,
    },
  };
}

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function parseBoundedIntegerEnv(
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const raw = process.env[key]?.trim();
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function getAiAnalysisMaxAttempts(): number {
  return parseBoundedIntegerEnv("AI_ANALYSIS_MAX_ATTEMPTS", 2, 1, 3);
}

function getAiAnalysisHttpTimeoutMs(): number {
  return parseBoundedIntegerEnv("AI_ANALYSIS_HTTP_TIMEOUT_MS", 45_000, 5_000, 120_000);
}

function getAiAnalysisResponsePollTimeoutMs(): number {
  return parseBoundedIntegerEnv(
    "AI_ANALYSIS_RESPONSE_POLL_TIMEOUT_MS",
    150_000,
    10_000,
    240_000,
  );
}

function getAiAnalysisResponsePollIntervalMs(): number {
  return parseBoundedIntegerEnv("AI_ANALYSIS_RESPONSE_POLL_INTERVAL_MS", 1_500, 250, 10_000);
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      error.message.toLowerCase().includes("aborted"))
  );
}

function isNetworkLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message}`.toLowerCase();
  return (
    error instanceof TypeError ||
    text.includes("fetch failed") ||
    text.includes("econnreset") ||
    text.includes("enotfound") ||
    text.includes("econnrefused") ||
    text.includes("network")
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
): Promise<{
  output: NegotiationAnalysisOutput;
  rawOutput: unknown;
  model: string;
  metrics: AiAnalysisRunMetrics;
}> {
  const startedAt = Date.now();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiAnalysisProviderError({
      code: "CONFIG_MISSING",
      provider: "openai",
      message: "OpenAI API key is missing.",
      retryable: false,
    });
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

  let completion: Awaited<ReturnType<typeof client.chat.completions.create>>;
  const callStartedAt = Date.now();
  try {
    completion = await client.chat.completions.create({
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
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new AiAnalysisProviderError({
        code: "NETWORK_TIMEOUT",
        provider: "openai",
        model,
        message: "OpenAI analysis request timed out.",
        retryable: true,
        cause: error,
      });
    }
    if (isNetworkLikeError(error)) {
      throw new AiAnalysisProviderError({
        code: "NETWORK_ERROR",
        provider: "openai",
        model,
        message: "OpenAI analysis network request failed.",
        retryable: true,
        cause: error,
      });
    }
    throw error;
  }

  const rawContent = completion.choices[0]?.message?.content ?? "";
  const finalModel = completion.model ?? model;
  const callMetric: AiAnalysisCallMetric = {
    attemptNumber: 1,
    callNumber: 1,
    purpose: "primary",
    model: finalModel,
    durationMs: Date.now() - callStartedAt,
    promptChars: prompt.length,
    estimatedInputTokens: estimateTokensFromChars(prompt.length),
    maxOutputTokens: 0,
    responseLength: rawContent.length,
    httpStatus: null,
    providerStatus: completion.choices[0]?.finish_reason ?? null,
    responseIdPresent: false,
    pollingAttemptCount: 0,
    errorClass: null,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    callMetric.errorClass = "MODEL_INVALID_OUTPUT";
    const error = new AiAnalysisProviderError({
      code: "MODEL_INVALID_OUTPUT",
      provider: "openai",
      model: finalModel,
      message: `OpenAI analysis returned non-JSON output (responseLength=${rawContent.length}).`,
      retryable: false,
      diagnostics: { responseLength: rawContent.length },
    });
    error.metrics = {
      provider: "openai",
      model: finalModel,
      totalDurationMs: Date.now() - startedAt,
      promptChars: prompt.length,
      estimatedInputTokens: estimateTokensFromChars(prompt.length),
      modelCallCount: 1,
      retryCount: 0,
      maxAttempts: 1,
      timeoutMs: 0,
      responseLength: rawContent.length,
      outputChars: 0,
      errorClass: "MODEL_INVALID_OUTPUT",
      calls: [callMetric],
    };
    throw error;
  }

  const validated = NegotiationAnalysisOutputSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    callMetric.errorClass = "MODEL_SCHEMA_VALIDATION_ERROR";
    const error = new AiAnalysisProviderError({
      code: "MODEL_SCHEMA_VALIDATION_ERROR",
      provider: "openai",
      model: finalModel,
      message: `OpenAI analysis response failed schema validation: ${issues}`,
      retryable: false,
      diagnostics: { issues },
    });
    error.metrics = {
      provider: "openai",
      model: finalModel,
      totalDurationMs: Date.now() - startedAt,
      promptChars: prompt.length,
      estimatedInputTokens: estimateTokensFromChars(prompt.length),
      modelCallCount: 1,
      retryCount: 0,
      maxAttempts: 1,
      timeoutMs: 0,
      responseLength: rawContent.length,
      outputChars: JSON.stringify(parsed).length,
      errorClass: "MODEL_SCHEMA_VALIDATION_ERROR",
      calls: [callMetric],
    };
    throw error;
  }

  return {
    output: validated.data,
    rawOutput: parsed,
    model: finalModel,
    metrics: {
      provider: "openai",
      model: finalModel,
      totalDurationMs: Date.now() - startedAt,
      promptChars: prompt.length,
      estimatedInputTokens: estimateTokensFromChars(prompt.length),
      modelCallCount: 1,
      retryCount: 0,
      maxAttempts: 1,
      timeoutMs: 0,
      responseLength: rawContent.length,
      outputChars: JSON.stringify(validated.data).length,
      errorClass: null,
      calls: [callMetric],
    },
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

type YandexOutputFieldDetected =
  | "output_text"
  | "output.content.text"
  | "output.text"
  | "response.output_text"
  | "result.output_text"
  | "result"
  | "none";

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function extractYandexOutputText(payload: Record<string, unknown>, depth = 0): {
  text: string;
  outputFieldDetected: YandexOutputFieldDetected;
  rawOutputCharCount: number;
} {
  if (depth > 4) {
    return { text: "", outputFieldDetected: "none", rawOutputCharCount: 0 };
  }

  const outputText = payload.output_text;
  if (typeof outputText === "string") {
    return {
      text: outputText.trim(),
      outputFieldDetected: "output_text",
      rawOutputCharCount: outputText.length,
    };
  }

  const output = payload.output;
  const outputItems = Array.isArray(output) ? output : output ? [output] : [];
  const chunks: string[] = [];
  let outputFieldDetected: YandexOutputFieldDetected = "none";
  let rawOutputCharCount = 0;

  for (const item of outputItems) {
    const itemRecord = toRecord(item);
    if (!itemRecord) continue;

    if (typeof itemRecord.text === "string") {
      outputFieldDetected = "output.text";
      rawOutputCharCount += itemRecord.text.length;
      if (itemRecord.text.trim()) chunks.push(itemRecord.text.trim());
    }

    const content = itemRecord.content;
    const contentItems = Array.isArray(content) ? content : content ? [content] : [];
    for (const part of contentItems) {
      const partRecord = toRecord(part);
      if (!partRecord) continue;
      const text =
        typeof partRecord.text === "string"
          ? partRecord.text
          : typeof partRecord.output_text === "string"
            ? partRecord.output_text
            : "";
      if (text) {
        outputFieldDetected = "output.content.text";
        rawOutputCharCount += text.length;
        if (text.trim()) chunks.push(text.trim());
      }
    }
  }

  if (chunks.length > 0 || outputFieldDetected !== "none") {
    return {
      text: chunks.join("\n").trim(),
      outputFieldDetected,
      rawOutputCharCount,
    };
  }

  const responseRecord = toRecord(payload.response);
  if (responseRecord) {
    const nested = extractYandexOutputText(responseRecord, depth + 1);
    if (nested.text || nested.outputFieldDetected !== "none") {
      return {
        text: nested.text,
        outputFieldDetected:
          nested.outputFieldDetected === "none"
            ? "response.output_text"
            : nested.outputFieldDetected,
        rawOutputCharCount: nested.rawOutputCharCount,
      };
    }
  }

  const resultRecord = toRecord(payload.result);
  if (resultRecord) {
    const nested = extractYandexOutputText(resultRecord, depth + 1);
    if (nested.text || nested.outputFieldDetected !== "none") {
      return {
        text: nested.text,
        outputFieldDetected:
          nested.outputFieldDetected === "none"
            ? "result.output_text"
            : nested.outputFieldDetected,
        rawOutputCharCount: nested.rawOutputCharCount,
      };
    }
    return { text: "", outputFieldDetected: "result", rawOutputCharCount: 0 };
  }

  return { text: "", outputFieldDetected: "none", rawOutputCharCount: 0 };
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  params: {
    provider: AiAnalysisProviderName;
    model: string;
    purpose: string;
  },
): Promise<{ response: Response; text: string; durationMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text, durationMs: Date.now() - startedAt };
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new AiAnalysisProviderError({
        code: "NETWORK_TIMEOUT",
        provider: params.provider,
        model: params.model,
        message: `${params.purpose} timed out after ${timeoutMs}ms.`,
        retryable: true,
        diagnostics: { timeoutMs, purpose: params.purpose },
        cause: error,
      });
    }
    if (isNetworkLikeError(error)) {
      throw new AiAnalysisProviderError({
        code: "NETWORK_ERROR",
        provider: params.provider,
        model: params.model,
        message: `${params.purpose} failed due to a network error.`,
        retryable: true,
        diagnostics: { purpose: params.purpose },
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function pollYandexResponseUntilOutput(params: {
  baseUrl: string;
  responseId: string;
  headers: HeadersInit;
  modelName: string;
  timeoutMs: number;
}): Promise<{
  envelope: Record<string, unknown> | null;
  outputText: string;
  outputFieldDetected: YandexOutputFieldDetected;
  rawOutputCharCount: number;
  providerStatus: string | null;
  pollingAttemptCount: number;
}> {
  const startedAt = Date.now();
  let pollingAttemptCount = 0;
  let providerStatus: string | null = null;
  let outputFieldDetected: YandexOutputFieldDetected = "none";
  let rawOutputCharCount = 0;

  while (Date.now() - startedAt < params.timeoutMs) {
    pollingAttemptCount += 1;
    const { response, text } = await fetchTextWithTimeout(
      `${params.baseUrl}/responses/${encodeURIComponent(params.responseId)}`,
      { method: "GET", headers: params.headers },
      Math.min(getAiAnalysisHttpTimeoutMs(), params.timeoutMs),
      {
        provider: "yandex",
        model: params.modelName,
        purpose: "Yandex AI response polling request",
      },
    );
    if (!response.ok) {
      const code: AiAnalysisErrorCode =
        response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_HTTP_ERROR";
      throw new AiAnalysisProviderError({
        code,
        provider: "yandex",
        model: params.modelName,
        httpStatus: response.status,
        message: `Yandex AI polling failed with HTTP ${response.status} (bodyLength=${text.length}).`,
        retryable: response.status === 429 || response.status >= 500,
        diagnostics: {
          httpStatus: response.status,
          bodyLength: text.length,
          responseIdPresent: true,
        },
      });
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new AiAnalysisProviderError({
        code: "MODEL_INVALID_OUTPUT",
        provider: "yandex",
        model: params.modelName,
        message: `Yandex AI polling returned non-JSON envelope (bodyLength=${text.length}).`,
        retryable: false,
        diagnostics: { bodyLength: text.length, responseIdPresent: true },
      });
    }

    const status = envelope.status;
    providerStatus = typeof status === "string" ? status : null;
    const extraction = extractYandexOutputText(envelope);
    outputFieldDetected = extraction.outputFieldDetected;
    rawOutputCharCount = extraction.rawOutputCharCount;
    if (extraction.text) {
      return {
        envelope,
        outputText: extraction.text,
        outputFieldDetected,
        rawOutputCharCount,
        providerStatus,
        pollingAttemptCount,
      };
    }

    if (status === "failed" || status === "cancelled" || status === "incomplete") {
      return {
        envelope,
        outputText: "",
        outputFieldDetected,
        rawOutputCharCount,
        providerStatus,
        pollingAttemptCount,
      };
    }

    await delay(getAiAnalysisResponsePollIntervalMs());
  }

  return {
    envelope: null,
    outputText: "",
    outputFieldDetected,
    rawOutputCharCount,
    providerStatus,
    pollingAttemptCount,
  };
}
async function runYandexNegotiationAnalysis(
  prompt: string,
  language: string,
): Promise<{
  output: NegotiationAnalysisOutput;
  rawOutput: unknown;
  model: string;
  metrics: AiAnalysisRunMetrics;
}> {
  const runStartedAt = Date.now();
  const folderId = process.env.YANDEX_FOLDER_ID?.trim();
  const apiKey = process.env.YANDEX_API_KEY?.trim();
  if (!folderId || !apiKey) {
    throw new AiAnalysisProviderError({
      code: "CONFIG_MISSING",
      provider: "yandex",
      message: "Yandex AI configuration is missing.",
      retryable: false,
    });
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

  const headers: HeadersInit = {
    Authorization: `Api-Key ${safeApiKey}`,
    "Content-Type": "application/json",
    "x-folder-id": safeFolderId,
    "x-data-logging-enabled": "false",
  };
  const promptChars = prompt.length;
  const estimatedInputTokens = estimateTokensFromChars(promptChars);
  const calls: AiAnalysisCallMetric[] = [];
  const maxAttempts = getAiAnalysisMaxAttempts();
  const timeoutMs = getAiAnalysisHttpTimeoutMs() + getAiAnalysisResponsePollTimeoutMs();

  function buildMetrics(params: {
    retryCount: number;
    responseLength?: number;
    outputChars?: number;
    errorClass?: AiAnalysisErrorCode | null;
  }): AiAnalysisRunMetrics {
    return {
      provider: "yandex",
      model: modelName,
      totalDurationMs: Date.now() - runStartedAt,
      promptChars,
      estimatedInputTokens,
      modelCallCount: calls.length,
      retryCount: params.retryCount,
      maxAttempts,
      timeoutMs,
      responseLength: params.responseLength ?? 0,
      outputChars: params.outputChars ?? 0,
      errorClass: params.errorClass ?? null,
      calls: [...calls],
    };
  }

  async function requestModelOutput(params: {
    attemptNumber: number;
    tokenLimit: number;
    purpose: AiAnalysisCallMetric["purpose"];
    compactJsonMode?: boolean;
    depthRetryReason?: string;
  }): Promise<{ envelope: Record<string, unknown>; cleaned: string; responseLength: number }> {
    const compactInstruction = params.compactJsonMode
      ? "\n\nOutput constraints: return strict minified JSON only, no markdown, no comments, no trailing commas, concise strings."
      : "";
    const depthInstruction = params.depthRetryReason
      ? `\n\nYour previous output was too shallow. Fix these quality gaps while keeping strict JSON schema:\n- ${params.depthRetryReason}`
      : "";
    const callStartedAt = Date.now();
    const callMetric: AiAnalysisCallMetric = {
      attemptNumber: params.attemptNumber,
      callNumber: calls.length + 1,
      purpose: params.purpose,
      model: modelName,
      durationMs: 0,
      promptChars,
      estimatedInputTokens,
      maxOutputTokens: params.tokenLimit,
      responseLength: 0,
      httpStatus: null,
      providerStatus: null,
      responseIdPresent: false,
      pollingAttemptCount: 0,
      errorClass: null,
    };

    try {
      const { response, text } = await fetchTextWithTimeout(
        `${baseUrl}/responses`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelUri,
            temperature: 0.2,
            max_output_tokens: params.tokenLimit,
            instructions: `${SYSTEM_PROMPT}\n\n${langInstruction}\n\n${YANDEX_COACHING_REQUIREMENTS}\n\n${schemaDescription}${compactInstruction}${depthInstruction}`,
            input: prompt,
          }),
        },
        getAiAnalysisHttpTimeoutMs(),
        {
          provider: "yandex",
          model: modelName,
          purpose: "Yandex AI analysis request",
        },
      );
      callMetric.httpStatus = response.status;
      if (!response.ok) {
        const code: AiAnalysisErrorCode =
          response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_HTTP_ERROR";
        callMetric.errorClass = code;
        throw new AiAnalysisProviderError({
          code,
          provider: "yandex",
          model: modelName,
          httpStatus: response.status,
          message: `Yandex AI request failed with HTTP ${response.status} (bodyLength=${text.length}).`,
          retryable: response.status === 429 || response.status >= 500,
          diagnostics: { httpStatus: response.status, bodyLength: text.length },
        });
      }

      let envelope: Record<string, unknown>;
      try {
        envelope = JSON.parse(text) as Record<string, unknown>;
      } catch {
        callMetric.errorClass = "MODEL_INVALID_OUTPUT";
        throw new AiAnalysisProviderError({
          code: "MODEL_INVALID_OUTPUT",
          provider: "yandex",
          model: modelName,
          message: `Yandex AI analysis returned non-JSON envelope (bodyLength=${text.length}).`,
          retryable: false,
          diagnostics: { bodyLength: text.length },
        });
      }

      const responseId =
        typeof envelope.id === "string" && envelope.id.trim()
          ? envelope.id.trim()
          : null;
      const initialStatus = typeof envelope.status === "string" ? envelope.status : null;
      let output = extractYandexOutputText(envelope);
      callMetric.responseIdPresent = Boolean(responseId);
      callMetric.providerStatus = initialStatus;

      if (
        !output.text &&
        responseId &&
        initialStatus !== "completed" &&
        initialStatus !== "failed" &&
        initialStatus !== "cancelled" &&
        initialStatus !== "incomplete"
      ) {
        const polled = await pollYandexResponseUntilOutput({
          baseUrl,
          responseId,
          headers,
          modelName,
          timeoutMs: getAiAnalysisResponsePollTimeoutMs(),
        });
        callMetric.pollingAttemptCount = polled.pollingAttemptCount;
        callMetric.providerStatus = polled.providerStatus ?? callMetric.providerStatus;
        if (polled.envelope) {
          envelope = polled.envelope;
        }
        output = {
          text: polled.outputText,
          outputFieldDetected: polled.outputFieldDetected,
          rawOutputCharCount: polled.rawOutputCharCount,
        };
      }

      callMetric.responseLength = output.rawOutputCharCount;
      if (!output.text) {
        callMetric.errorClass = "MODEL_EMPTY_OUTPUT";
        throw new AiAnalysisProviderError({
          code: "MODEL_EMPTY_OUTPUT",
          provider: "yandex",
          model: modelName,
          message: `Yandex AI analysis failed: empty model output (model=${modelName}, responseLength=0).`,
          retryable: true,
          diagnostics: {
            responseIdPresent: Boolean(responseId),
            providerStatus: callMetric.providerStatus,
            outputFieldDetected: output.outputFieldDetected,
            pollingAttemptCount: callMetric.pollingAttemptCount,
          },
        });
      }

      const { cleaned, fencesRemoved } = stripMarkdownJsonFences(output.text);
      if (fencesRemoved) {
        console.warn(
          `[AI analysis] Yandex response required markdown fence cleanup (model=${modelName}, responseLength=${output.rawOutputCharCount}).`,
        );
      }
      callMetric.responseLength = cleaned.length;
      return { envelope, cleaned, responseLength: cleaned.length };
    } catch (error) {
      if (error instanceof AiAnalysisProviderError) {
        callMetric.errorClass = error.code;
      }
      throw error;
    } finally {
      callMetric.durationMs = Date.now() - callStartedAt;
      calls.push(callMetric);
    }
  }

  let lastError: unknown = null;
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    try {
      let requestResult = await requestModelOutput({
        attemptNumber,
        tokenLimit: maxOutputTokens,
        purpose: "primary",
      });
      let parsed = tryParseJsonWithRecovery(requestResult.cleaned);

      if (!parsed && looksPossiblyTruncatedJson(requestResult.cleaned)) {
        const retryTokens = Math.max(maxOutputTokens, 6500);
        console.warn(
          `[AI analysis] Retrying Yandex analysis with compact JSON mode (model=${modelName}, max_output_tokens=${retryTokens}).`,
        );
        requestResult = await requestModelOutput({
          attemptNumber,
          tokenLimit: retryTokens,
          purpose: "compact_json_retry",
          compactJsonMode: true,
        });
        parsed = tryParseJsonWithRecovery(requestResult.cleaned);
      }

      if (!parsed) {
        const responseLength = requestResult.cleaned.length;
        const kind = looksPossiblyTruncatedJson(requestResult.cleaned)
          ? "truncated/invalid JSON"
          : "invalid JSON";
        throw new AiAnalysisProviderError({
          code: "MODEL_INVALID_OUTPUT",
          provider: "yandex",
          model: modelName,
          message: `Yandex AI analysis failed: ${kind} (model=${modelName}, responseLength=${responseLength}).`,
          retryable: false,
          diagnostics: { responseLength, kind },
        });
      }

      const validated = NegotiationAnalysisOutputSchema.safeParse(parsed);
      if (!validated.success) {
        const issues = validated.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new AiAnalysisProviderError({
          code: "MODEL_SCHEMA_VALIDATION_ERROR",
          provider: "yandex",
          model: modelName,
          message: `Yandex AI response failed schema validation: ${issues}`,
          retryable: false,
          diagnostics: { issues },
        });
      }

      let selectedOutput = validated.data;
      const depthIssues = assessAnalysisDepth(selectedOutput);
      if (depthIssues.length > 0) {
        const retryTokens = Math.max(maxOutputTokens, 7000);
        console.warn(
          `[AI analysis] Retrying Yandex analysis for deeper coaching output (model=${modelName}, issues=${depthIssues.length}).`,
        );
        const depthRetry = await requestModelOutput({
          attemptNumber,
          tokenLimit: retryTokens,
          purpose: "depth_retry",
          depthRetryReason: depthIssues.slice(0, 6).join("\n- "),
        });
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
        metrics: buildMetrics({
          retryCount: attemptNumber - 1,
          responseLength: requestResult.responseLength,
          outputChars: JSON.stringify(selectedOutput).length,
          errorClass: null,
        }),
      };
    } catch (error) {
      lastError = error;
      const classified = classifyAiAnalysisError(error);
      const retryable = classified.retryable && attemptNumber < maxAttempts;
      if (!retryable) {
        if (error instanceof AiAnalysisProviderError) {
          error.metrics = buildMetrics({
            retryCount: attemptNumber - 1,
            errorClass: error.code,
          });
        }
        throw error;
      }
      console.warn(
        `[AI analysis] Retrying Yandex analysis after transient failure (model=${modelName}, attempt=${attemptNumber}, errorClass=${classified.code}).`,
      );
      await delay(500 * attemptNumber);
    }
  }

  const classified = classifyAiAnalysisError(lastError);
  const error =
    lastError instanceof AiAnalysisProviderError
      ? lastError
      : new AiAnalysisProviderError({
          code: classified.code,
          provider: "yandex",
          model: modelName,
          message: "Yandex AI analysis failed.",
          retryable: false,
          cause: lastError,
        });
  error.metrics = buildMetrics({
    retryCount: Math.max(0, maxAttempts - 1),
    errorClass: error.code,
  });
  throw error;
}

export async function runNegotiationAnalysis(
  prompt: string,
  language: string,
): Promise<{
  output: NegotiationAnalysisOutput;
  rawOutput: unknown;
  model: string;
  metrics: AiAnalysisRunMetrics;
}> {
  const provider = getAiAnalysisProvider();
  const providers = {
    openai: runOpenAiNegotiationAnalysis,
    yandex: runYandexNegotiationAnalysis,
  };
  return providers[provider](prompt, language);
}
