import OpenAI from "openai";
import { z } from "zod";
import {
  YANDEX_DEEPSEEK_ANALYSIS_PROMPT_TOKEN_BUDGET,
  YANDEX_DEEPSEEK_ANALYSIS_TOTAL_INPUT_TOKEN_BUDGET,
  estimateAiAnalysisTokensFromChars,
} from "@/lib/ai/analysis-input-budget";
import { buildBoundedSchemaIssueDiagnostics } from "@/lib/ai/analysis-failure-diagnostics";
import {
  AI_ANALYSIS_MAX_EXTRA_SCHEMA_RECOVERY_GENERATIONS,
  AI_ANALYSIS_TOTAL_GENERATIONS_MAX,
} from "@/lib/ai/analysis-schema-recovery-policy";
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
    process.env.YANDEX_AI_MAX_OUTPUT_TOKENS?.trim() || "8000",
    10,
  );
  if (!Number.isFinite(raw)) {
    return 8000;
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
  | "PROVIDER_LIFECYCLE_ERROR"
  | "MODEL_EMPTY_OUTPUT"
  | "MODEL_INVALID_OUTPUT"
  | "MODEL_SCHEMA_VALIDATION_ERROR"
  | "INPUT_TOO_LARGE"
  | "INTERNAL_ERROR"
  | "CANCELLED"
  | "OWNERSHIP_LOST";

export type AiAnalysisProviderName = "openai" | "yandex";

export type AiAnalysisCallMetric = {
  operationAttemptNumber: number;
  generationCallNumber: number;
  purpose: "primary" | "compact_fallback" | "optional_depth";
  model: string;
  durationMs: number;
  generationPostDurationMs: number;
  pollingDurationMs: number;
  promptChars: number;
  instructionChars: number;
  inputChars: number;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  responseLength: number;
  httpStatus: number | null;
  providerStatus: string | null;
  responseIdPresent: boolean;
  pollingRequestCount: number;
  retrievalRetryCount: number;
  errorClass: AiAnalysisErrorCode | null;
};

export type AiAnalysisRunMetrics = {
  provider: AiAnalysisProviderName;
  model: string;
  totalDurationMs: number;
  preProviderDurationMs: number;
  generationPostDurationMs: number;
  pollingDurationMs: number;
  parsingValidationDurationMs: number;
  optionalDepthDurationMs: number;
  promptChars: number;
  estimatedPromptTokens: number;
  instructionChars: number;
  inputChars: number;
  estimatedInputTokens: number;
  outputSchemaInstructionChars: number;
  primaryMaxOutputTokensConfigured: number;
  operationAttemptCount: number;
  outerRetryCount: number;
  maxOperationAttempts: number;
  generationCallCount: number;
  compactFallbackCount: number;
  optionalDepthCallCount: number;
  pollingRequestCount: number;
  retrievalRetryCount: number;
  operationTimeoutMs: number;
  httpTimeoutMs: number;
  responsePollTimeoutMs: number;
  optionalDepthOutcome:
    | "not_needed"
    | "improved"
    | "failed"
    | "invalid"
    | "not_improved"
    | "skipped_deadline";
  optionalDepthFailureClass: AiAnalysisErrorCode | null;
  responseLength: number;
  outputChars: number;
  errorClass: AiAnalysisErrorCode | null;
  calls: AiAnalysisCallMetric[];
};

export type AiAnalysisExecutionOptions = {
  signal?: AbortSignal;
  /**
   * Fenced durable lease checkpoint. False means another operation owns the
   * analysis and all local work must stop without terminalizing.
   */
  renewLease?: (checkpoint: string) => Promise<boolean>;
  monotonicNow?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  fetch?: typeof fetch;
  operationStartedAtMonotonic?: number;
  existingProviderResponseId?: string | null;
  persistProviderResponseId?: (providerResponseId: string) => Promise<boolean>;
};

export class AiAnalysisProviderError extends Error {
  readonly code: AiAnalysisErrorCode;
  readonly provider: AiAnalysisProviderName;
  readonly model: string | null;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly allowsRegeneration: boolean;
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
    allowsRegeneration?: boolean;
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
    this.allowsRegeneration =
      params.allowsRegeneration ?? (params.retryable ?? false);
    this.userMessage = params.userMessage ?? defaultAiAnalysisUserMessage(params.code);
    this.diagnostics = params.diagnostics ?? {};
  }
}

function defaultAiAnalysisUserMessage(code: AiAnalysisErrorCode): string {
  switch (code) {
    case "CONFIG_MISSING":
      return "Провайдер ИИ-разбора не настроен.";
    case "NETWORK_TIMEOUT":
      return "Не удалось завершить ИИ-разбор вовремя. Повторите попытку.";
    case "NETWORK_ERROR":
      return "Не удалось связаться с провайдером ИИ-разбора. Повторите попытку.";
    case "PROVIDER_RATE_LIMIT":
      return "Провайдер ИИ-разбора временно ограничил запросы. Повторите попытку позже.";
    case "PROVIDER_HTTP_ERROR":
      return "Провайдер ИИ-разбора вернул ошибку. Повторите попытку позже.";
    case "PROVIDER_LIFECYCLE_ERROR":
      return "ИИ-разбор не был завершён успешно. Повторите попытку.";
    case "MODEL_EMPTY_OUTPUT":
      return "ИИ-разбор не был сформирован полностью. Повторите попытку.";
    case "MODEL_INVALID_OUTPUT":
      return "ИИ-разбор вернулся в некорректном формате. Повторите попытку.";
    case "MODEL_SCHEMA_VALIDATION_ERROR":
      return "ИИ-разбор не прошёл проверку формата. Повторите попытку.";
    case "INPUT_TOO_LARGE":
      return "Транскрипт слишком велик для полного безопасного ИИ-разбора без потери содержания.";
    case "CANCELLED":
      return "ИИ-разбор был отменён.";
    case "OWNERSHIP_LOST":
      return "ИИ-разбор уже выполняется в другом процессе.";
    default:
      return "ИИ-разбор не выполнен. Повторите попытку.";
  }
}

export function classifyAiAnalysisError(error: unknown): {
  code: AiAnalysisErrorCode;
  provider: AiAnalysisProviderName | null;
  model: string | null;
  httpStatus: number | null;
  retryable: boolean;
  allowsRegeneration: boolean;
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
      allowsRegeneration: error.allowsRegeneration,
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
    allowsRegeneration: false,
    userMessage: defaultAiAnalysisUserMessage(code),
    diagnostics: {
      errorName: error instanceof Error ? error.name : "UnknownError",
      messageLength: message.length,
    },
  };
}

/**
 * Whether an accepted background generation may still produce a usable result
 * after this failure, so a later re-entry can retrieve that same response
 * instead of creating a new generation.
 *
 * Codes that only appear once a response was retrieved and judged unusable
 * exhaust the recorded generation: retrieving it again can never succeed, and
 * treating it as recoverable would make every later retry replay the same
 * terminal outcome. Everything else keeps the recorded generation, because
 * abandoning a generation that is still running is what creates duplicates.
 */
export function canRecoverProviderResponseAfterFailure(
  code: AiAnalysisErrorCode,
): boolean {
  switch (code) {
    case "PROVIDER_LIFECYCLE_ERROR":
    case "PROVIDER_HTTP_ERROR":
    case "PROVIDER_RATE_LIMIT":
    case "MODEL_EMPTY_OUTPUT":
    case "MODEL_INVALID_OUTPUT":
    case "MODEL_SCHEMA_VALIDATION_ERROR":
    case "INPUT_TOO_LARGE":
      return false;
    default:
      return true;
  }
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

export function getAiAnalysisMaxAttempts(): number {
  return parseBoundedIntegerEnv("AI_ANALYSIS_MAX_ATTEMPTS", 1, 1, 1);
}

export function getAiAnalysisHttpTimeoutMs(): number {
  return parseBoundedIntegerEnv("AI_ANALYSIS_HTTP_TIMEOUT_MS", 20_000, 5_000, 120_000);
}

export function getAiAnalysisResponsePollTimeoutMs(): number {
  return parseBoundedIntegerEnv(
    "AI_ANALYSIS_RESPONSE_POLL_TIMEOUT_MS",
    300_000,
    10_000,
    600_000,
  );
}

export function getAiAnalysisResponsePollIntervalMs(): number {
  return parseBoundedIntegerEnv("AI_ANALYSIS_RESPONSE_POLL_INTERVAL_MS", 1_500, 250, 10_000);
}

export function getAiAnalysisOperationTimeoutMs(): number {
  return parseBoundedIntegerEnv(
    "AI_ANALYSIS_OPERATION_TIMEOUT_MS",
    600_000,
    120_000,
    1_200_000,
  );
}

export function getAiAnalysisMaxPollRequests(): number {
  return parseBoundedIntegerEnv("AI_ANALYSIS_MAX_POLL_REQUESTS", 100, 1, 10_000);
}

/**
 * Conservative structural cost/latency model for one owned analysis operation.
 *
 * `maxGenerationPosts` is the ordinary single-invocation POST budget
 * (adapter retries remain clamped to 1; compact/depth extras stay 0).
 * `maxOwnedOperationGenerationPosts` is the bounded Yandex schema-recovery
 * ceiling (generation 1 + at most one same-prompt recovery POST).
 *
 * `maxPollingRequestsPerGeneration` is one provider-generation GET budget
 * from poll timeout / interval. `maxPollingRequests` is the owned-operation
 * total (`maxOwnedOperationGenerationPosts * maxPollingRequestsPerGeneration`).
 * That total is a conservative structural bound: both generations still share
 * the single original operation deadline, so remaining budget can cut the
 * second generation short.
 */
export function getAiAnalysisPerformanceModel() {
  const maxOperationAttempts = getAiAnalysisMaxAttempts();
  const maxPrimaryGenerationPosts = maxOperationAttempts;
  const maxCompactFallbackCalls = 0;
  const maxOptionalDepthCalls = 0;
  const maxGenerationPosts =
    maxPrimaryGenerationPosts +
    maxCompactFallbackCalls +
    maxOptionalDepthCalls;
  const maxPollingRequestsPerGeneration = Math.ceil(
    getAiAnalysisResponsePollTimeoutMs() / getAiAnalysisResponsePollIntervalMs(),
  );
  const maxOwnedOperationGenerationPosts = AI_ANALYSIS_TOTAL_GENERATIONS_MAX;
  const maxPollingRequests =
    maxOwnedOperationGenerationPosts * maxPollingRequestsPerGeneration;
  return {
    beforeReviewTheoreticalWorstCaseMs: 24 * 60_000,
    maxOperationAttempts,
    maxPrimaryGenerationPosts,
    maxCompactFallbackCalls,
    maxOptionalDepthCalls,
    maxGenerationPosts,
    maxSchemaRecoveryExtraGenerations:
      AI_ANALYSIS_MAX_EXTRA_SCHEMA_RECOVERY_GENERATIONS,
    maxOwnedOperationGenerationPosts,
    maxPollingRequestsPerGeneration,
    maxPollingRequests,
    perResponsePollTimeoutMs: getAiAnalysisResponsePollTimeoutMs(),
    operationTimeoutMs: getAiAnalysisOperationTimeoutMs(),
    theoreticalDefaultWorstCaseMs: getAiAnalysisOperationTimeoutMs(),
  };
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

function monotonicNow(options?: AiAnalysisExecutionOptions): number {
  return options?.monotonicNow?.() ?? performance.now();
}

async function abortableDelay(
  ms: number,
  options?: AiAnalysisExecutionOptions,
): Promise<void> {
  if (ms <= 0) return;
  if (options?.signal?.aborted) {
    throw new AiAnalysisProviderError({
      code: "CANCELLED",
      provider: "yandex",
      message: "AI analysis request was cancelled.",
      diagnostics: { cancellationSource: "request" },
      allowsRegeneration: false,
    });
  }
  if (options?.sleep) {
    await options.sleep(ms, options.signal);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(finish, ms);
    const signal = options?.signal;
    function finish() {
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(timeout);
      resolve();
    }
    function onAbort() {
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(timeout);
      reject(
        new AiAnalysisProviderError({
          code: "CANCELLED",
          provider: "yandex",
          message: "AI analysis request was cancelled.",
          diagnostics: { cancellationSource: "request" },
          allowsRegeneration: false,
        }),
      );
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function executionCheckpoint(params: {
  options?: AiAnalysisExecutionOptions;
  provider: AiAnalysisProviderName;
  model: string;
  checkpoint: string;
}): Promise<void> {
  if (params.options?.signal?.aborted) {
    throw new AiAnalysisProviderError({
      code: "CANCELLED",
      provider: params.provider,
      model: params.model,
      message: "AI analysis request was cancelled.",
      diagnostics: {
        cancellationSource: "request",
        checkpoint: params.checkpoint,
      },
      allowsRegeneration: false,
    });
  }
  if (
    params.options?.renewLease &&
    !(await params.options.renewLease(params.checkpoint))
  ) {
    throw new AiAnalysisProviderError({
      code: "OWNERSHIP_LOST",
      provider: params.provider,
      model: params.model,
      message: "AI analysis ownership lease was lost.",
      diagnostics: { checkpoint: params.checkpoint },
      allowsRegeneration: false,
    });
  }
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
  sessionParticipantId: z.string().min(1),
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

/**
 * Historical persisted-read compatibility only. Not the write/generation
 * contract. Completed reports persisted before `sessionParticipantId` became
 * required may omit that field on personal-feedback items, or omit
 * `participantPersonalFeedback` entirely. Readers must not synthesize IDs or
 * write this shape back as new provider output.
 */
export const HistoricalPersistedParticipantPersonalFeedbackSchema =
  ParticipantPersonalFeedbackSchema.extend({
    sessionParticipantId: z.string().min(1).optional(),
  });

export const HistoricalPersistedNegotiationAnalysisSchema =
  NegotiationAnalysisOutputSchema.extend({
    participantPersonalFeedback: z
      .array(HistoricalPersistedParticipantPersonalFeedbackSchema)
      .optional(),
  });

export type HistoricalPersistedParticipantPersonalFeedback = z.infer<
  typeof HistoricalPersistedParticipantPersonalFeedbackSchema
>;

export type HistoricalPersistedNegotiationAnalysis = z.infer<
  typeof HistoricalPersistedNegotiationAnalysisSchema
>;

/**
 * Provider output may only bind personal feedback through the stable
 * SessionParticipant identifier that was supplied in the prompt. This keeps
 * duplicate display names from becoming an authorization key.
 */
export function bindParticipantPersonalFeedback(
  output: NegotiationAnalysisOutput,
  participants: Array<{ id: string; displayName: string; type: string }>,
): NegotiationAnalysisOutput {
  const participantsById = new Map(
    participants
      .filter((participant) => participant.type === "PARTICIPANT")
      .map((participant) => [participant.id, participant]),
  );

  return {
    ...output,
    participantPersonalFeedback: output.participantPersonalFeedback.flatMap(
      (feedback) => {
        const participant = participantsById.get(feedback.sessionParticipantId);
        if (!participant) return [];
        return [{
          ...feedback,
          // The current server-side participant record, rather than model text,
          // is the canonical display label saved with the report.
          participantName: participant.displayName,
        }];
      },
    ),
  };
}

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

const YANDEX_ANALYSIS_SCHEMA_DESCRIPTION = `Respond with a JSON object matching this TypeScript type exactly:
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
  participantPersonalFeedback: Array<{ sessionParticipantId: string; participantName: string; achievements: string[]; couldHaveDoneBetter: string[]; keyMoments: string[]; nextSteps: string[]; }>; // use only a supplied negotiating participant ID; role-specific, actionable
}`;

const OPENAI_ANALYSIS_SCHEMA_DESCRIPTION = `Respond with a JSON object matching this TypeScript type exactly:
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
    sessionParticipantId: string; // exact supplied SessionParticipant ID of the negotiating participant
    participantName: string; // matching display label, for presentation only
    achievements: string[]; // 2-4 specific things this participant did well, with evidence
    couldHaveDoneBetter: string[]; // 2-4 specific areas where this participant underperformed, with evidence and concrete improvement tips
    keyMoments: string[]; // 2-3 key moments that were decisive for this participant (good or missed)
    nextSteps: string[]; // 2-3 personalized, actionable next steps for this participant's development
  }>; // one entry per negotiating participant (exclude facilitators and observers)
}`;

const YANDEX_POLL_MAX_TRANSIENT_GET_ERRORS = 20;

export function getAnalysisPromptContracts() {
  return {
    systemPrompt: SYSTEM_PROMPT,
    yandexCoachingRequirements: YANDEX_COACHING_REQUIREMENTS,
    yandexSchemaDescription: YANDEX_ANALYSIS_SCHEMA_DESCRIPTION,
    openAiSchemaDescription: OPENAI_ANALYSIS_SCHEMA_DESCRIPTION,
  };
}

export function getYandexAnalysisStaticProfile(language = "en") {
  const languageInstruction =
    language === "ru" || language === "RU"
      ? "Respond in Russian language."
      : "Respond in English language.";
  const baseInstructions = `${SYSTEM_PROMPT}\n\n${languageInstruction}\n\n${YANDEX_COACHING_REQUIREMENTS}\n\n${YANDEX_ANALYSIS_SCHEMA_DESCRIPTION}`;
  return {
    outputSchemaInstructionChars:
      YANDEX_ANALYSIS_SCHEMA_DESCRIPTION.length,
    coachingInstructionChars: YANDEX_COACHING_REQUIREMENTS.length,
    systemInstructionChars: SYSTEM_PROMPT.length,
    languageInstructionChars: languageInstruction.length,
    baseInstructionChars: baseInstructions.length,
    primaryMaxOutputTokensConfigured: getYandexAiMaxOutputTokens(),
  };
}

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
        sessionParticipantId: "mock-participant-a",
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
        sessionParticipantId: "mock-participant-b",
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
  options?: AiAnalysisExecutionOptions,
): Promise<{
  output: NegotiationAnalysisOutput;
  rawOutput: unknown;
  model: string;
  metrics: AiAnalysisRunMetrics;
}> {
  const providerAdapterStartedAt = monotonicNow(options);
  const startedAt =
    options?.operationStartedAtMonotonic ?? providerAdapterStartedAt;
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

  const schemaDescription = OPENAI_ANALYSIS_SCHEMA_DESCRIPTION;
  const instructions = `${SYSTEM_PROMPT}\n\n${langInstruction}\n\n${schemaDescription}`;
  const instructionChars = instructions.length;
  const inputChars = prompt.length + instructionChars;

  let completion: Awaited<ReturnType<typeof client.chat.completions.create>>;
  const callStartedAt = monotonicNow(options);
  try {
    await executionCheckpoint({
      options,
      provider: "openai",
      model,
      checkpoint: "before_generation_post",
    });
    completion = await client.chat.completions.create(
      {
        model,
        response_format: { type: "json_object" },
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: instructions,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      { signal: options?.signal },
    );
    await executionCheckpoint({
      options,
      provider: "openai",
      model,
      checkpoint: "after_generation_response",
    });
  } catch (error) {
    if (options?.signal?.aborted) {
      throw new AiAnalysisProviderError({
        code: "CANCELLED",
        provider: "openai",
        model,
        message: "OpenAI analysis request was cancelled by the caller.",
        retryable: false,
        allowsRegeneration: false,
        diagnostics: { cancellationSource: "request" },
        cause: error,
      });
    }
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
  const generationPostDurationMs =
    monotonicNow(options) - callStartedAt;
  const callMetric: AiAnalysisCallMetric = {
    operationAttemptNumber: 1,
    generationCallNumber: 1,
    purpose: "primary",
    model: finalModel,
    durationMs: generationPostDurationMs,
    generationPostDurationMs,
    pollingDurationMs: 0,
    promptChars: prompt.length,
    instructionChars,
    inputChars,
    estimatedInputTokens: estimateAiAnalysisTokensFromChars(inputChars),
    maxOutputTokens: 0,
    responseLength: rawContent.length,
    httpStatus: null,
    providerStatus: completion.choices[0]?.finish_reason ?? null,
    responseIdPresent: false,
    pollingRequestCount: 0,
    retrievalRetryCount: 0,
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
      totalDurationMs: monotonicNow(options) - startedAt,
      preProviderDurationMs: callStartedAt - startedAt,
      generationPostDurationMs: callMetric.generationPostDurationMs,
      pollingDurationMs: 0,
      parsingValidationDurationMs: Math.max(
        0,
        monotonicNow(options) -
          callStartedAt -
          callMetric.generationPostDurationMs,
      ),
      optionalDepthDurationMs: 0,
      promptChars: prompt.length,
      estimatedPromptTokens: estimateAiAnalysisTokensFromChars(prompt.length),
      instructionChars,
      inputChars,
      estimatedInputTokens: estimateAiAnalysisTokensFromChars(inputChars),
      outputSchemaInstructionChars: schemaDescription.length,
      primaryMaxOutputTokensConfigured: 0,
      operationAttemptCount: 1,
      outerRetryCount: 0,
      maxOperationAttempts: 1,
      generationCallCount: 1,
      compactFallbackCount: 0,
      optionalDepthCallCount: 0,
      pollingRequestCount: 0,
      retrievalRetryCount: 0,
      operationTimeoutMs: 0,
      httpTimeoutMs: 0,
      responsePollTimeoutMs: 0,
      optionalDepthOutcome: "not_needed",
      optionalDepthFailureClass: null,
      responseLength: rawContent.length,
      outputChars: 0,
      errorClass: "MODEL_INVALID_OUTPUT",
      calls: [callMetric],
    };
    throw error;
  }

  const validated = NegotiationAnalysisOutputSchema.safeParse(parsed);
  if (!validated.success) {
    const bounded = buildBoundedSchemaIssueDiagnostics(validated.error);
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
      diagnostics: { issues, ...bounded },
    });
    error.metrics = {
      provider: "openai",
      model: finalModel,
      totalDurationMs: monotonicNow(options) - startedAt,
      preProviderDurationMs: callStartedAt - startedAt,
      generationPostDurationMs: callMetric.generationPostDurationMs,
      pollingDurationMs: 0,
      parsingValidationDurationMs: Math.max(
        0,
        monotonicNow(options) -
          callStartedAt -
          callMetric.generationPostDurationMs,
      ),
      optionalDepthDurationMs: 0,
      promptChars: prompt.length,
      estimatedPromptTokens: estimateAiAnalysisTokensFromChars(prompt.length),
      instructionChars,
      inputChars,
      estimatedInputTokens: estimateAiAnalysisTokensFromChars(inputChars),
      outputSchemaInstructionChars: schemaDescription.length,
      primaryMaxOutputTokensConfigured: 0,
      operationAttemptCount: 1,
      outerRetryCount: 0,
      maxOperationAttempts: 1,
      generationCallCount: 1,
      compactFallbackCount: 0,
      optionalDepthCallCount: 0,
      pollingRequestCount: 0,
      retrievalRetryCount: 0,
      operationTimeoutMs: 0,
      httpTimeoutMs: 0,
      responsePollTimeoutMs: 0,
      optionalDepthOutcome: "not_needed",
      optionalDepthFailureClass: null,
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
      totalDurationMs: monotonicNow(options) - startedAt,
      preProviderDurationMs: callStartedAt - startedAt,
      generationPostDurationMs: callMetric.generationPostDurationMs,
      pollingDurationMs: 0,
      parsingValidationDurationMs: Math.max(
        0,
        monotonicNow(options) -
          callStartedAt -
          callMetric.generationPostDurationMs,
      ),
      optionalDepthDurationMs: 0,
      promptChars: prompt.length,
      estimatedPromptTokens: estimateAiAnalysisTokensFromChars(prompt.length),
      instructionChars,
      inputChars,
      estimatedInputTokens: estimateAiAnalysisTokensFromChars(inputChars),
      outputSchemaInstructionChars: schemaDescription.length,
      primaryMaxOutputTokensConfigured: 0,
      operationAttemptCount: 1,
      outerRetryCount: 0,
      maxOperationAttempts: 1,
      generationCallCount: 1,
      compactFallbackCount: 0,
      optionalDepthCallCount: 0,
      pollingRequestCount: 0,
      retrievalRetryCount: 0,
      operationTimeoutMs: 0,
      httpTimeoutMs: 0,
      responsePollTimeoutMs: 0,
      optionalDepthOutcome: "not_needed",
      optionalDepthFailureClass: null,
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

export function tryParseJsonWithRecovery(input: string): unknown | null {
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

export function getAnalysisDepthIssues(
  output: NegotiationAnalysisOutput,
): string[] {
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

export function extractYandexOutputText(payload: Record<string, unknown>, depth = 0): {
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
    options?: AiAnalysisExecutionOptions;
    acceptanceUnknownOnFailure?: boolean;
  },
): Promise<{ response: Response; text: string; durationMs: number }> {
  if (params.options?.signal?.aborted) {
    throw new AiAnalysisProviderError({
      code: "CANCELLED",
      provider: params.provider,
      model: params.model,
      message: `${params.purpose} was cancelled by the caller.`,
      diagnostics: { cancellationSource: "request", purpose: params.purpose },
      allowsRegeneration: false,
    });
  }
  const controller = new AbortController();
  let localTimeoutFired = false;
  const timeout = setTimeout(() => {
    localTimeoutFired = true;
    controller.abort();
  }, Math.max(1, timeoutMs));
  const parentSignal = params.options?.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const startedAt = monotonicNow(params.options);
  try {
    const fetchImpl = params.options?.fetch ?? fetch;
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return {
      response,
      text,
      durationMs: monotonicNow(params.options) - startedAt,
    };
  } catch (error) {
    if (parentSignal?.aborted) {
      throw new AiAnalysisProviderError({
        code: "CANCELLED",
        provider: params.provider,
        model: params.model,
        message: `${params.purpose} was cancelled by the caller.`,
        retryable: false,
        allowsRegeneration: false,
        diagnostics: { cancellationSource: "request", purpose: params.purpose },
        cause: error,
      });
    }
    if (localTimeoutFired || isAbortLikeError(error)) {
      throw new AiAnalysisProviderError({
        code: "NETWORK_TIMEOUT",
        provider: params.provider,
        model: params.model,
        message: `${params.purpose} timed out after ${timeoutMs}ms.`,
        retryable: true,
        allowsRegeneration: !params.acceptanceUnknownOnFailure,
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
        allowsRegeneration: !params.acceptanceUnknownOnFailure,
        diagnostics: { purpose: params.purpose },
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export type YandexResponseLifecycle =
  | { kind: "nonterminal"; status: "queued" | "in_progress" }
  | { kind: "success"; status: "completed" }
  | {
      kind: "failure";
      status: "failed" | "cancelled" | "incomplete";
      providerErrorCode: string | null;
      incompleteReason: string | null;
    }
  | { kind: "unknown"; status: string | null };

function boundedProviderCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const bounded = value.trim().replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80);
  return bounded || null;
}

export function classifyYandexResponseLifecycle(
  envelope: Record<string, unknown>,
): YandexResponseLifecycle {
  const status =
    typeof envelope.status === "string"
      ? envelope.status.trim().toLowerCase()
      : null;
  if (status === "queued" || status === "in_progress") {
    return { kind: "nonterminal", status };
  }
  if (status === "completed") {
    return { kind: "success", status };
  }
  if (status === "failed" || status === "cancelled" || status === "incomplete") {
    const providerError = toRecord(envelope.error);
    const incompleteDetails = toRecord(envelope.incomplete_details);
    return {
      kind: "failure",
      status,
      providerErrorCode:
        boundedProviderCode(providerError?.code) ??
        boundedProviderCode(providerError?.type),
      incompleteReason: boundedProviderCode(incompleteDetails?.reason),
    };
  }
  return {
    kind: "unknown",
    status: boundedProviderCode(status),
  };
}

function yandexLifecycleError(params: {
  lifecycle: YandexResponseLifecycle;
  modelName: string;
  responseIdPresent: boolean;
  pollingRequestCount: number;
}): AiAnalysisProviderError {
  if (params.lifecycle.kind === "failure") {
    return new AiAnalysisProviderError({
      code: "PROVIDER_LIFECYCLE_ERROR",
      provider: "yandex",
      model: params.modelName,
      message: `Yandex AI response reached terminal non-success status ${params.lifecycle.status}.`,
      retryable: params.lifecycle.status !== "failed",
      allowsRegeneration: false,
      diagnostics: {
        providerStatus: params.lifecycle.status,
        providerErrorCode: params.lifecycle.providerErrorCode,
        incompleteReason: params.lifecycle.incompleteReason,
        responseIdPresent: params.responseIdPresent,
        pollingRequestCount: params.pollingRequestCount,
      },
    });
  }
  return new AiAnalysisProviderError({
    code: "PROVIDER_LIFECYCLE_ERROR",
    provider: "yandex",
    model: params.modelName,
    message: "Yandex AI response returned an unsupported lifecycle status.",
    retryable: false,
    allowsRegeneration: false,
    diagnostics: {
      providerStatus:
        params.lifecycle.kind === "unknown" ? params.lifecycle.status : null,
      responseIdPresent: params.responseIdPresent,
      pollingRequestCount: params.pollingRequestCount,
    },
  });
}

function yandexPollDeadlineError(params: {
  modelName: string;
  providerStatus: string | null;
  pollingRequestCount: number;
  retrievalRetryCount: number;
  pollTimeoutMs: number;
  maxPollRequestsReached: boolean;
}): AiAnalysisProviderError {
  return new AiAnalysisProviderError({
    code: "NETWORK_TIMEOUT",
    provider: "yandex",
    model: params.modelName,
    message: "Yandex AI response retrieval did not complete before its deadline.",
    retryable: true,
    allowsRegeneration: false,
    diagnostics: {
      timeoutScope: "known_response_poll",
      pollTimeoutMs: params.pollTimeoutMs,
      providerStatus: params.providerStatus,
      responseIdPresent: true,
      pollingRequestCount: params.pollingRequestCount,
      retrievalRetryCount: params.retrievalRetryCount,
      maxPollRequestsReached: params.maxPollRequestsReached,
    },
  });
}

async function pollYandexResponseUntilTerminal(params: {
  baseUrl: string;
  responseId: string;
  headers: HeadersInit;
  modelName: string;
  deadline: number;
  pollTimeoutMs: number;
  options?: AiAnalysisExecutionOptions;
  recordParsingValidationDuration?: (durationMs: number) => void;
}): Promise<{
  envelope: Record<string, unknown>;
  outputText: string;
  outputFieldDetected: YandexOutputFieldDetected;
  rawOutputCharCount: number;
  providerStatus: string | null;
  pollingRequestCount: number;
  retrievalRetryCount: number;
}> {
  let pollingRequestCount = 0;
  let retrievalRetryCount = 0;
  let providerStatus: string | null = null;

  while (true) {
    await executionCheckpoint({
      options: params.options,
      provider: "yandex",
      model: params.modelName,
      checkpoint: "before_known_response_get",
    });
    const remaining = params.deadline - monotonicNow(params.options);
    if (remaining <= 0) break;
    pollingRequestCount += 1;

    let response: Response;
    let text: string;
    try {
      ({ response, text } = await fetchTextWithTimeout(
        `${params.baseUrl}/responses/${encodeURIComponent(params.responseId)}`,
        { method: "GET", headers: params.headers },
        Math.max(1, Math.min(getAiAnalysisHttpTimeoutMs(), remaining)),
        {
          provider: "yandex",
          model: params.modelName,
          purpose: "Yandex AI response polling request",
          options: params.options,
        },
      ));
    } catch (error) {
      const classified = classifyAiAnalysisError(error);
      if (
        classified.code === "CANCELLED" ||
        classified.code === "OWNERSHIP_LOST"
      ) {
        throw error;
      }
      if (!classified.retryable) throw error;
      retrievalRetryCount += 1;
      if (retrievalRetryCount >= YANDEX_POLL_MAX_TRANSIENT_GET_ERRORS) {
        throw yandexPollDeadlineError({
          modelName: params.modelName,
          providerStatus,
          pollingRequestCount,
          retrievalRetryCount,
          pollTimeoutMs: params.pollTimeoutMs,
          maxPollRequestsReached: false,
        });
      }
      const retryRemaining = params.deadline - monotonicNow(params.options);
      const backoffMs = Math.min(
        getAiAnalysisResponsePollIntervalMs() * retrievalRetryCount,
        5_000,
      );
      if (retryRemaining <= backoffMs) break;
      await abortableDelay(backoffMs, params.options);
      continue;
    }

    if (!response.ok) {
      const code: AiAnalysisErrorCode =
        response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_HTTP_ERROR";
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) {
        throw new AiAnalysisProviderError({
          code,
          provider: "yandex",
          model: params.modelName,
          httpStatus: response.status,
          message: `Yandex AI response retrieval failed with HTTP ${response.status}.`,
          retryable: false,
          allowsRegeneration: false,
          diagnostics: {
            httpStatus: response.status,
            bodyLength: text.length,
            responseIdPresent: true,
            pollingRequestCount,
          },
        });
      }
      retrievalRetryCount += 1;
      if (retrievalRetryCount >= YANDEX_POLL_MAX_TRANSIENT_GET_ERRORS) {
        throw yandexPollDeadlineError({
          modelName: params.modelName,
          providerStatus,
          pollingRequestCount,
          retrievalRetryCount,
          pollTimeoutMs: params.pollTimeoutMs,
          maxPollRequestsReached: false,
        });
      }
      const retryRemaining = params.deadline - monotonicNow(params.options);
      const backoffMs = Math.min(
        getAiAnalysisResponsePollIntervalMs() * retrievalRetryCount,
        5_000,
      );
      if (retryRemaining <= backoffMs) break;
      await abortableDelay(backoffMs, params.options);
      continue;
    }

    let envelope: Record<string, unknown>;
    const parsingStartedAt = monotonicNow(params.options);
    try {
      envelope = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new AiAnalysisProviderError({
        code: "MODEL_INVALID_OUTPUT",
        provider: "yandex",
        model: params.modelName,
        message: "Yandex AI response retrieval returned a non-JSON envelope.",
        retryable: false,
        allowsRegeneration: false,
        diagnostics: {
          bodyLength: text.length,
          responseIdPresent: true,
          pollingRequestCount,
        },
      });
    } finally {
      params.recordParsingValidationDuration?.(
        monotonicNow(params.options) - parsingStartedAt,
      );
    }

    await executionCheckpoint({
      options: params.options,
      provider: "yandex",
      model: params.modelName,
      checkpoint: "after_known_response_get",
    });
    const lifecycle = classifyYandexResponseLifecycle(envelope);
    providerStatus = lifecycle.status;
    if (lifecycle.kind === "success") {
      const extraction = extractYandexOutputText(envelope);
      return {
        envelope,
        outputText: extraction.text,
        outputFieldDetected: extraction.outputFieldDetected,
        rawOutputCharCount: extraction.rawOutputCharCount,
        providerStatus,
        pollingRequestCount,
        retrievalRetryCount,
      };
    }
    if (lifecycle.kind !== "nonterminal") {
      throw yandexLifecycleError({
        lifecycle,
        modelName: params.modelName,
        responseIdPresent: true,
        pollingRequestCount,
      });
    }

    const sleepRemaining = params.deadline - monotonicNow(params.options);
    const intervalMs = getAiAnalysisResponsePollIntervalMs();
    if (sleepRemaining <= intervalMs) break;
    await abortableDelay(intervalMs, params.options);
  }

  throw yandexPollDeadlineError({
    modelName: params.modelName,
    providerStatus,
    pollingRequestCount,
    retrievalRetryCount,
    pollTimeoutMs: params.pollTimeoutMs,
    maxPollRequestsReached: false,
  });
}
async function runYandexNegotiationAnalysis(
  prompt: string,
  language: string,
  options?: AiAnalysisExecutionOptions,
): Promise<{
  output: NegotiationAnalysisOutput;
  rawOutput: unknown;
  model: string;
  metrics: AiAnalysisRunMetrics;
}> {
  const providerAdapterStartedAt = monotonicNow(options);
  const runStartedAt =
    options?.operationStartedAtMonotonic ?? providerAdapterStartedAt;
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

  const schemaDescription = YANDEX_ANALYSIS_SCHEMA_DESCRIPTION;
  const baseInstructions = `${SYSTEM_PROMPT}\n\n${langInstruction}\n\n${YANDEX_COACHING_REQUIREMENTS}\n\n${schemaDescription}`;

  const headers: HeadersInit = {
    Authorization: `Api-Key ${safeApiKey}`,
    "Content-Type": "application/json",
    "x-folder-id": safeFolderId,
    "x-data-logging-enabled": "false",
  };
  const promptChars = prompt.length;
  const estimatedPromptTokens = estimateAiAnalysisTokensFromChars(promptChars);
  const instructionChars = baseInstructions.length;
  const inputChars = promptChars + instructionChars;
  const estimatedInputTokens = estimateAiAnalysisTokensFromChars(inputChars);
  if (
    estimatedInputTokens >
      YANDEX_DEEPSEEK_ANALYSIS_TOTAL_INPUT_TOKEN_BUDGET &&
    !options?.existingProviderResponseId?.trim()
  ) {
    throw new AiAnalysisProviderError({
      code: "INPUT_TOO_LARGE",
      provider: "yandex",
      model: modelName,
      message:
        "Complete Yandex analysis input exceeds the conservative application budget.",
      retryable: false,
      allowsRegeneration: false,
      diagnostics: {
        inputChars,
        estimatedInputTokens,
        estimatedTotalInputTokenBudget:
          YANDEX_DEEPSEEK_ANALYSIS_TOTAL_INPUT_TOKEN_BUDGET,
        contentDropped: false,
      },
    });
  }
  const calls: AiAnalysisCallMetric[] = [];
  const maxOperationAttempts = getAiAnalysisMaxAttempts();
  const maxCompactFallbackCalls = 0;
  const maxOptionalDepthCalls = 0;
  const operationTimeoutMs = getAiAnalysisOperationTimeoutMs();
  const operationDeadline = runStartedAt + operationTimeoutMs;
  let operationAttemptCount = 0;
  let firstProviderRequestStartedAt: number | null = null;
  let parsingValidationDurationMs = 0;
  let optionalDepthDurationMs = 0;
  let optionalDepthOutcome: AiAnalysisRunMetrics["optionalDepthOutcome"] =
    "not_needed";
  let optionalDepthFailureClass: AiAnalysisErrorCode | null = null;

  function buildMetrics(params: {
    responseLength?: number;
    outputChars?: number;
    errorClass?: AiAnalysisErrorCode | null;
  }): AiAnalysisRunMetrics {
    return {
      provider: "yandex",
      model: modelName,
      totalDurationMs: monotonicNow(options) - runStartedAt,
      preProviderDurationMs: Math.max(
        0,
        (firstProviderRequestStartedAt ?? providerAdapterStartedAt) -
          runStartedAt,
      ),
      generationPostDurationMs: calls.reduce(
        (total, call) => total + call.generationPostDurationMs,
        0,
      ),
      pollingDurationMs: calls.reduce(
        (total, call) => total + call.pollingDurationMs,
        0,
      ),
      parsingValidationDurationMs,
      optionalDepthDurationMs,
      promptChars,
      estimatedPromptTokens,
      instructionChars,
      inputChars,
      estimatedInputTokens,
      outputSchemaInstructionChars: schemaDescription.length,
      primaryMaxOutputTokensConfigured: maxOutputTokens,
      operationAttemptCount,
      outerRetryCount: Math.max(0, operationAttemptCount - 1),
      maxOperationAttempts,
      generationCallCount: calls.length,
      compactFallbackCount: calls.filter(
        (call) => call.purpose === "compact_fallback",
      ).length,
      optionalDepthCallCount: calls.filter(
        (call) => call.purpose === "optional_depth",
      ).length,
      pollingRequestCount: calls.reduce(
        (total, call) => total + call.pollingRequestCount,
        0,
      ),
      retrievalRetryCount: calls.reduce(
        (total, call) => total + call.retrievalRetryCount,
        0,
      ),
      operationTimeoutMs,
      httpTimeoutMs: getAiAnalysisHttpTimeoutMs(),
      responsePollTimeoutMs: getAiAnalysisResponsePollTimeoutMs(),
      optionalDepthOutcome,
      optionalDepthFailureClass,
      responseLength: params.responseLength ?? 0,
      outputChars: params.outputChars ?? 0,
      errorClass: params.errorClass ?? null,
      calls: [...calls],
    };
  }

  function measureParsingValidation<T>(operation: () => T): T {
    const startedAt = monotonicNow(options);
    try {
      return operation();
    } finally {
      parsingValidationDurationMs += monotonicNow(options) - startedAt;
    }
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
    const instructions = `${baseInstructions}${compactInstruction}${depthInstruction}`;
    const callInstructionChars = instructions.length;
    const callInputChars = promptChars + callInstructionChars;

    await executionCheckpoint({
      options,
      provider: "yandex",
      model: modelName,
      checkpoint: `before_${params.purpose}_generation_post`,
    });
    const remainingBeforePost = operationDeadline - monotonicNow(options);
    if (remainingBeforePost <= 0) {
      throw new AiAnalysisProviderError({
        code: "NETWORK_TIMEOUT",
        provider: "yandex",
        model: modelName,
        message: "Yandex AI analysis operation deadline was exhausted.",
        retryable: true,
        allowsRegeneration: false,
        diagnostics: {
          timeoutScope: "operation",
          operationTimeoutMs,
          generationCallCount: calls.length,
        },
      });
    }

    const callStartedAt = monotonicNow(options);
    const callMetric: AiAnalysisCallMetric = {
      operationAttemptNumber: params.attemptNumber,
      generationCallNumber: calls.length + 1,
      purpose: params.purpose,
      model: modelName,
      durationMs: 0,
      generationPostDurationMs: 0,
      pollingDurationMs: 0,
      promptChars,
      instructionChars: callInstructionChars,
      inputChars: callInputChars,
      estimatedInputTokens: estimateAiAnalysisTokensFromChars(callInputChars),
      maxOutputTokens: params.tokenLimit,
      responseLength: 0,
      httpStatus: null,
      providerStatus: null,
      responseIdPresent: false,
      pollingRequestCount: 0,
      retrievalRetryCount: 0,
      errorClass: null,
    };

    try {
      firstProviderRequestStartedAt ??= monotonicNow(options);
      const existingProviderResponseId =
        params.purpose === "primary" && calls.length === 0
          ? (options?.existingProviderResponseId?.trim() || null)
          : null;
      if (existingProviderResponseId) {
        callMetric.responseIdPresent = true;
        const pollTimeoutMs = getAiAnalysisResponsePollTimeoutMs();
        const pollingStartedAt = monotonicNow(options);
        let polled: Awaited<ReturnType<typeof pollYandexResponseUntilTerminal>>;
        try {
          polled = await pollYandexResponseUntilTerminal({
            baseUrl,
            responseId: existingProviderResponseId,
            headers,
            modelName,
            deadline: Math.min(
              operationDeadline,
              monotonicNow(options) + pollTimeoutMs,
            ),
            pollTimeoutMs,
            options,
            recordParsingValidationDuration: (durationMs) => {
              parsingValidationDurationMs += durationMs;
            },
          });
        } finally {
          callMetric.pollingDurationMs +=
            monotonicNow(options) - pollingStartedAt;
        }
        callMetric.pollingRequestCount = polled.pollingRequestCount;
        callMetric.retrievalRetryCount = polled.retrievalRetryCount;
        callMetric.providerStatus = polled.providerStatus;
        callMetric.responseLength = polled.rawOutputCharCount;
        if (!polled.outputText) {
          callMetric.errorClass = "MODEL_EMPTY_OUTPUT";
          throw new AiAnalysisProviderError({
            code: "MODEL_EMPTY_OUTPUT",
            provider: "yandex",
            model: modelName,
            message: "Yandex AI completed successfully but returned empty model output.",
            retryable: true,
            allowsRegeneration: false,
            diagnostics: {
              responseIdPresent: true,
              providerStatus: callMetric.providerStatus,
              outputFieldDetected: polled.outputFieldDetected,
              pollingRequestCount: callMetric.pollingRequestCount,
            },
          });
        }
        const { cleaned } = stripMarkdownJsonFences(polled.outputText);
        callMetric.responseLength = cleaned.length;
        return { envelope: polled.envelope, cleaned, responseLength: cleaned.length };
      }
      const {
        response,
        text,
        durationMs: generationPostDurationMs,
      } = await fetchTextWithTimeout(
        `${baseUrl}/responses`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelUri,
            temperature: 0.2,
            max_output_tokens: params.tokenLimit,
            reasoning: { effort: "none" },
            background: true,
            instructions,
            input: prompt,
          }),
        },
        Math.max(
          1,
          Math.min(getAiAnalysisHttpTimeoutMs(), remainingBeforePost),
        ),
        {
          provider: "yandex",
          model: modelName,
          purpose: "Yandex AI analysis request",
          options,
          acceptanceUnknownOnFailure: true,
        },
      );
      callMetric.generationPostDurationMs = generationPostDurationMs;
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
          message: `Yandex AI request failed with HTTP ${response.status}.`,
          retryable: response.status === 429 || response.status >= 500,
          diagnostics: { httpStatus: response.status, bodyLength: text.length },
        });
      }

      let envelope: Record<string, unknown>;
      try {
        envelope = measureParsingValidation(
          () => JSON.parse(text) as Record<string, unknown>,
        );
      } catch {
        callMetric.errorClass = "MODEL_INVALID_OUTPUT";
        throw new AiAnalysisProviderError({
          code: "MODEL_INVALID_OUTPUT",
          provider: "yandex",
          model: modelName,
          message: "Yandex AI analysis returned a non-JSON envelope.",
          retryable: false,
          diagnostics: { bodyLength: text.length },
        });
      }

      const responseId =
        typeof envelope.id === "string" && envelope.id.trim()
          ? envelope.id.trim()
          : null;
      const initialLifecycle = classifyYandexResponseLifecycle(envelope);
      callMetric.responseIdPresent = Boolean(responseId);
      callMetric.providerStatus = initialLifecycle.status;

      if (responseId && options?.persistProviderResponseId) {
        const persisted = await options.persistProviderResponseId(responseId);
        if (!persisted) {
          throw new AiAnalysisProviderError({
            code: "OWNERSHIP_LOST",
            provider: "yandex",
            model: modelName,
            message: "AI analysis ownership lease was lost while persisting provider response ID.",
            diagnostics: { checkpoint: "persist_provider_response_id" },
            allowsRegeneration: false,
          });
        }
      }

      await executionCheckpoint({
        options,
        provider: "yandex",
        model: modelName,
        checkpoint: `after_${params.purpose}_provider_response_id`,
      });

      let output: ReturnType<typeof extractYandexOutputText>;
      if (initialLifecycle.kind === "nonterminal") {
        if (!responseId) {
          throw new AiAnalysisProviderError({
            code: "PROVIDER_LIFECYCLE_ERROR",
            provider: "yandex",
            model: modelName,
            message:
              "Yandex AI returned a nonterminal response without a response ID.",
            retryable: false,
            allowsRegeneration: false,
            diagnostics: {
              providerStatus: initialLifecycle.status,
              responseIdPresent: false,
            },
          });
        }
        const pollTimeoutMs = getAiAnalysisResponsePollTimeoutMs();
        const pollingStartedAt = monotonicNow(options);
        let polled: Awaited<
          ReturnType<typeof pollYandexResponseUntilTerminal>
        >;
        try {
          polled = await pollYandexResponseUntilTerminal({
            baseUrl,
            responseId,
            headers,
            modelName,
            deadline: Math.min(
              operationDeadline,
              monotonicNow(options) + pollTimeoutMs,
            ),
            pollTimeoutMs,
            options,
            recordParsingValidationDuration: (durationMs) => {
              parsingValidationDurationMs += durationMs;
            },
          });
        } finally {
          callMetric.pollingDurationMs +=
            monotonicNow(options) - pollingStartedAt;
        }
        callMetric.pollingRequestCount = polled.pollingRequestCount;
        callMetric.retrievalRetryCount = polled.retrievalRetryCount;
        callMetric.providerStatus = polled.providerStatus ?? callMetric.providerStatus;
        envelope = polled.envelope;
        output = {
          text: polled.outputText,
          outputFieldDetected: polled.outputFieldDetected,
          rawOutputCharCount: polled.rawOutputCharCount,
        };
      } else if (initialLifecycle.kind === "success") {
        output = extractYandexOutputText(envelope);
      } else {
        throw yandexLifecycleError({
          lifecycle: initialLifecycle,
          modelName,
          responseIdPresent: Boolean(responseId),
          pollingRequestCount: 0,
        });
      }

      callMetric.responseLength = output.rawOutputCharCount;
      if (!output.text) {
        callMetric.errorClass = "MODEL_EMPTY_OUTPUT";
        throw new AiAnalysisProviderError({
          code: "MODEL_EMPTY_OUTPUT",
          provider: "yandex",
          model: modelName,
          message: "Yandex AI completed successfully but returned empty model output.",
          retryable: true,
          allowsRegeneration: false,
          diagnostics: {
            responseIdPresent: Boolean(responseId),
            providerStatus: callMetric.providerStatus,
            outputFieldDetected: output.outputFieldDetected,
            pollingRequestCount: callMetric.pollingRequestCount,
          },
        });
      }

      const { cleaned } = stripMarkdownJsonFences(output.text);
      callMetric.responseLength = cleaned.length;
      return { envelope, cleaned, responseLength: cleaned.length };
    } catch (error) {
      if (error instanceof AiAnalysisProviderError) {
        callMetric.errorClass = error.code;
        const pollingRequestCount = error.diagnostics.pollingRequestCount;
        const retrievalRetryCount = error.diagnostics.retrievalRetryCount;
        if (typeof pollingRequestCount === "number") {
          callMetric.pollingRequestCount = pollingRequestCount;
        }
        if (typeof retrievalRetryCount === "number") {
          callMetric.retrievalRetryCount = retrievalRetryCount;
        }
      }
      throw error;
    } finally {
      callMetric.durationMs = monotonicNow(options) - callStartedAt;
      calls.push(callMetric);
    }
  }

  type ModelOutputResult = Awaited<ReturnType<typeof requestModelOutput>>;

  function attachMetricsAndThrow(error: unknown): never {
    const classified = classifyAiAnalysisError(error);
    const providerError =
      error instanceof AiAnalysisProviderError
        ? error
        : new AiAnalysisProviderError({
            code: classified.code,
            provider: "yandex",
            model: modelName,
            message: "Yandex AI analysis failed.",
            retryable: false,
            allowsRegeneration: false,
            cause: error,
          });
    providerError.metrics = buildMetrics({ errorClass: providerError.code });
    throw providerError;
  }

  function invalidOutputError(requestResult: ModelOutputResult) {
    const truncated = looksPossiblyTruncatedJson(requestResult.cleaned);
    return new AiAnalysisProviderError({
      code: "MODEL_INVALID_OUTPUT",
      provider: "yandex",
      model: modelName,
      message: truncated
        ? "Yandex AI analysis returned truncated or invalid JSON."
        : "Yandex AI analysis returned invalid JSON.",
      retryable: false,
      allowsRegeneration: false,
      diagnostics: {
        responseLength: requestResult.cleaned.length,
        outputCondition: truncated ? "truncated_or_invalid" : "invalid",
      },
    });
  }

  function validateOutput(parsed: unknown): NegotiationAnalysisOutput {
    const validated = NegotiationAnalysisOutputSchema.safeParse(parsed);
    if (!validated.success) {
      throw new AiAnalysisProviderError({
        code: "MODEL_SCHEMA_VALIDATION_ERROR",
        provider: "yandex",
        model: modelName,
        message: "Yandex AI response failed schema validation.",
        retryable: false,
        allowsRegeneration: false,
        diagnostics: buildBoundedSchemaIssueDiagnostics(validated.error),
      });
    }
    return validated.data;
  }

  let baseRequest: ModelOutputResult | null = null;
  let baseOutput: NegotiationAnalysisOutput | null = null;
  let primaryTruncated = false;

  for (
    let attemptNumber = 1;
    attemptNumber <= maxOperationAttempts;
    attemptNumber += 1
  ) {
    operationAttemptCount = attemptNumber;
    try {
      const requestResult = await requestModelOutput({
        attemptNumber,
        tokenLimit: maxOutputTokens,
        purpose: "primary",
      });
      const parsed = measureParsingValidation(() =>
        tryParseJsonWithRecovery(requestResult.cleaned),
      );
      if (!parsed) {
        if (looksPossiblyTruncatedJson(requestResult.cleaned)) {
          baseRequest = requestResult;
          primaryTruncated = true;
          break;
        }
        throw invalidOutputError(requestResult);
      }
      baseRequest = requestResult;
      baseOutput = measureParsingValidation(() => validateOutput(parsed));
      break;
    } catch (error) {
      const classified = classifyAiAnalysisError(error);
      const mayCreateAnotherPrimary =
        classified.retryable &&
        classified.allowsRegeneration &&
        attemptNumber < maxOperationAttempts;
      if (!mayCreateAnotherPrimary) {
        attachMetricsAndThrow(error);
      }
      const backoffMs = 500 * attemptNumber;
      if (operationDeadline - monotonicNow(options) <= backoffMs) {
        attachMetricsAndThrow(error);
      }
      await abortableDelay(backoffMs, options);
    }
  }

  if (!baseOutput && primaryTruncated && maxCompactFallbackCalls > 0) {
    try {
      await executionCheckpoint({
        options,
        provider: "yandex",
        model: modelName,
        checkpoint: "before_compact_fallback",
      });
      const compactResult = await requestModelOutput({
        attemptNumber: operationAttemptCount,
        tokenLimit: Math.max(maxOutputTokens, 6_500),
        purpose: "compact_fallback",
        compactJsonMode: true,
      });
      const parsed = measureParsingValidation(() =>
        tryParseJsonWithRecovery(compactResult.cleaned),
      );
      if (!parsed) throw invalidOutputError(compactResult);
      baseRequest = compactResult;
      baseOutput = measureParsingValidation(() => validateOutput(parsed));
    } catch (error) {
      attachMetricsAndThrow(error);
    }
  }

  if (!baseOutput && primaryTruncated && baseRequest) {
    attachMetricsAndThrow(invalidOutputError(baseRequest));
  }

  if (!baseOutput || !baseRequest) {
    attachMetricsAndThrow(
      new AiAnalysisProviderError({
        code: "INTERNAL_ERROR",
        provider: "yandex",
        model: modelName,
        message: "Yandex AI analysis ended without a mandatory result.",
        allowsRegeneration: false,
      }),
    );
  }

  let selectedOutput = baseOutput;
  let selectedRequest = baseRequest;
  const depthIssues = getAnalysisDepthIssues(baseOutput);
  if (depthIssues.length > 0 && maxOptionalDepthCalls > 0) {
    const optionalDepthStartedAt = monotonicNow(options);
    await executionCheckpoint({
      options,
      provider: "yandex",
      model: modelName,
      checkpoint: "before_optional_depth",
    });
    if (operationDeadline - monotonicNow(options) <= 0) {
      optionalDepthOutcome = "skipped_deadline";
      optionalDepthFailureClass = "NETWORK_TIMEOUT";
    } else {
      try {
        const depthResult = await requestModelOutput({
          attemptNumber: operationAttemptCount,
          tokenLimit: Math.max(maxOutputTokens, 7_000),
          purpose: "optional_depth",
          depthRetryReason: depthIssues.slice(0, 6).join("\n- "),
        });
        const reparsed = measureParsingValidation(() =>
          tryParseJsonWithRecovery(depthResult.cleaned),
        );
        if (!reparsed) {
          optionalDepthOutcome = "invalid";
          optionalDepthFailureClass = "MODEL_INVALID_OUTPUT";
        } else {
          const revalidated = measureParsingValidation(() =>
            NegotiationAnalysisOutputSchema.safeParse(reparsed),
          );
          if (!revalidated.success) {
            optionalDepthOutcome = "invalid";
            optionalDepthFailureClass = "MODEL_SCHEMA_VALIDATION_ERROR";
          } else if (
            getAnalysisDepthIssues(revalidated.data).length < depthIssues.length
          ) {
            optionalDepthOutcome = "improved";
            selectedOutput = revalidated.data;
            selectedRequest = depthResult;
          } else {
            optionalDepthOutcome = "not_improved";
          }
        }
      } catch (error) {
        const classified = classifyAiAnalysisError(error);
        if (
          classified.code === "CANCELLED" ||
          classified.code === "OWNERSHIP_LOST"
        ) {
          attachMetricsAndThrow(error);
        }
        optionalDepthOutcome = "failed";
        optionalDepthFailureClass = classified.code;
      }
    }
    optionalDepthDurationMs =
      monotonicNow(options) - optionalDepthStartedAt;
  }

  return {
    output: selectedOutput,
    rawOutput: selectedRequest.envelope,
    model: modelName,
    metrics: buildMetrics({
      responseLength: selectedRequest.responseLength,
      outputChars: JSON.stringify(selectedOutput).length,
      errorClass: null,
    }),
  };
}

export function dispatchSelectedAiAnalysisProvider<T>(
  provider: AiAnalysisProviderName,
  adapters: Record<AiAnalysisProviderName, () => Promise<T>>,
): Promise<T> {
  // Selection is exact and fail-closed. In particular, a rejected Yandex
  // adapter promise is returned to the caller and never invokes OpenAI.
  return adapters[provider]();
}

export async function runNegotiationAnalysis(
  prompt: string,
  language: string,
  options?: AiAnalysisExecutionOptions,
): Promise<{
  output: NegotiationAnalysisOutput;
  rawOutput: unknown;
  model: string;
  metrics: AiAnalysisRunMetrics;
}> {
  const provider = getAiAnalysisProvider();
  const estimatedPromptTokens = estimateAiAnalysisTokensFromChars(
    prompt.length,
  );
  if (
    provider === "yandex" &&
    estimatedPromptTokens >
      YANDEX_DEEPSEEK_ANALYSIS_PROMPT_TOKEN_BUDGET &&
    !options?.existingProviderResponseId?.trim()
  ) {
    throw new AiAnalysisProviderError({
      code: "INPUT_TOO_LARGE",
      provider: "yandex",
      model: getYandexAiModel(),
      message:
        "Complete Yandex DeepSeek analysis prompt exceeds the conservative application input budget.",
      retryable: false,
      allowsRegeneration: false,
      diagnostics: {
        promptChars: prompt.length,
        estimatedPromptTokens,
        estimatedPromptTokenBudget:
          YANDEX_DEEPSEEK_ANALYSIS_PROMPT_TOKEN_BUDGET,
        contentDropped: false,
      },
    });
  }
  return dispatchSelectedAiAnalysisProvider(provider, {
    openai: () => runOpenAiNegotiationAnalysis(prompt, language, options),
    yandex: () => runYandexNegotiationAnalysis(prompt, language, options),
  });
}
