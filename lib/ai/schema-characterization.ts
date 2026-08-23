import {
  buildBoundedSchemaIssueDiagnostics,
} from "@/lib/ai/analysis-failure-diagnostics";
import {
  AiAnalysisProviderError,
  classifyAiAnalysisError,
  NegotiationAnalysisOutputSchema,
  type NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";
import type { BuildAnalysisPromptContext } from "@/lib/ai/session-analysis-prompt";

export const SCHEMA_CHARACTERIZATION_HARD_CAP = 15;
export const INCIDENT_SCHEMA_ISSUE_PATH =
  "listeningAndReframing.missedOpportunities.0";

export type CharacterizationFixtureId =
  | "ULTRA_SHORT"
  | "SHORT"
  | "NORMAL_CONTROL";

export type MissedOpportunitiesRuntimeShape =
  | "missing"
  | "empty_array"
  | "string_array"
  | "object_array"
  | "null_array"
  | "mixed_array"
  | "non_array"
  | "unknown";

export type InvalidResponseClass =
  | "INVALID_JSON"
  | "MISSING_REQUIRED_KEY"
  | "WRONG_ELEMENT_TYPE"
  | "WRONG_ENUM"
  | "WRONG_NESTED_TYPE"
  | "OTHER_SCHEMA"
  | null;

export type CharacterizationGenerationRecord = {
  fixture: CharacterizationFixtureId;
  runNumber: number;
  model: string | null;
  providerLifecycleResult: string | null;
  durationMs: number;
  responseLength: number | null;
  parseStatus: "valid" | "invalid" | "not_attempted";
  schemaStatus: "valid" | "invalid" | "not_attempted";
  schemaIssueCount: number;
  schemaIssuePaths: string[];
  missedOpportunitiesExists: boolean | null;
  missedOpportunitiesItemKinds: string[];
  missedOpportunitiesShape: MissedOpportunitiesRuntimeShape | null;
  requiredKeyPresence: "present" | "missing" | "unknown";
  outputCondition: string | null;
  incompleteReason: string | null;
  estimatedInputTokens: number | null;
  estimatedPromptTokens: number | null;
  errorClass: string | null;
  incidentPathMatch: boolean;
  invalidClass: InvalidResponseClass;
};

function participant(
  id: string,
  displayName: string,
  type: "PARTICIPANT" | "FACILITATOR",
  roleName: string | null,
): BuildAnalysisPromptContext["participants"][number] {
  return {
    id,
    displayName,
    type,
    roleName,
    notes: "",
  };
}

function role(
  id: string,
  name: string,
  objectives: string,
  constraints: string,
  hiddenInfo: string,
): BuildAnalysisPromptContext["roles"][number] {
  return {
    id,
    name,
    privateInstructions: `Synthetic ${name} briefing for characterization only.`,
    objectives,
    constraints,
    hiddenInfo,
    fallbackPosition: "Pause and ask for a later meeting.",
  };
}

function segment(
  orderIndex: number,
  speaker: "Buyer" | "Seller",
  startSeconds: number,
  text: string,
): NonNullable<BuildAnalysisPromptContext["transcript"]>["segments"][number] {
  return {
    orderIndex,
    speakerLabel: speaker === "Buyer" ? "speaker_1" : "speaker_2",
    mappedParticipantId:
      speaker === "Buyer" ? "synthetic-buyer" : "synthetic-seller",
    mappedParticipantName: speaker,
    startSeconds,
    endSeconds: startSeconds + 6,
    text,
  };
}

function buildContext(
  title: string,
  lines: Array<{ speaker: "Buyer" | "Seller"; text: string }>,
): BuildAnalysisPromptContext {
  const segments = lines.map((line, index) =>
    segment(index, line.speaker, index * 8, line.text),
  );
  const text = segments.map((item) => item.text).join(" ");
  const diarizedText = segments
    .map((item) => `${item.mappedParticipantName}: ${item.text}`)
    .join("\n");
  return {
    session: {
      id: `synthetic-${title.toLowerCase().replaceAll("_", "-")}`,
      title: `Synthetic ${title} characterization`,
      roomLabel: "synthetic-room",
      status: "COMPLETED",
      caseTitle: "Synthetic warehouse-service negotiation",
      caseLanguage: "RU",
      publicInstructions:
        "Agree on monthly storage volume, start date, and a service package.",
      businessContext:
        "A buyer and a seller negotiate a short warehouse-service contract. All names and facts are synthetic.",
      preparationDurationSeconds: 300,
      durationSeconds: Math.max(180, lines.length * 20),
      startedAt: "2026-08-01T10:00:00.000Z",
      endedAt: "2026-08-01T10:08:00.000Z",
      negotiationStartedAt: "2026-08-01T10:00:00.000Z",
      negotiationEndedAt: "2026-08-01T10:08:00.000Z",
      sequenceNumber: 1,
    },
    event: {
      id: "synthetic-event",
      title: "Synthetic characterization event",
      status: "COMPLETED",
    },
    roles: [
      role(
        "role-buyer",
        "Buyer",
        "Secure enough storage without overpaying.",
        "Budget and start date are limited.",
        "Can add volume later if onboarding support is included.",
      ),
      role(
        "role-seller",
        "Seller",
        "Protect margin and keep the start date realistic.",
        "Floor team capacity is limited this month.",
        "Support hours can be bundled cheaper than a discount.",
      ),
    ],
    participants: [
      participant("synthetic-buyer", "Buyer", "PARTICIPANT", "Buyer"),
      participant("synthetic-seller", "Seller", "PARTICIPANT", "Seller"),
      participant("synthetic-facilitator", "Facilitator", "FACILITATOR", null),
    ],
    transcript: {
      id: `synthetic-transcript-${title.toLowerCase()}`,
      text,
      diarizedText,
      language: "ru-RU",
      transcriptionModel: "synthetic",
      hasSpeakerDiarization: true,
      segments,
    },
  };
}

const ULTRA_SHORT_LINES = [
  { speaker: "Buyer" as const, text: "Сто пятьдесят тысяч — наш потолок на этот склад." },
  { speaker: "Seller" as const, text: "Тогда старт только через восемь недель." },
  { speaker: "Buyer" as const, text: "Нам нужно раньше, иначе срывается отгрузка." },
  { speaker: "Seller" as const, text: "Без доплаты ускорить приёмку не получится." },
];

const SHORT_LINES = [
  { speaker: "Buyer" as const, text: "Нам нужно двести палетомест с первого октября." },
  { speaker: "Seller" as const, text: "Октябрь плотный. Могу сто пятьдесят и старт пятнадцатого." },
  { speaker: "Buyer" as const, text: "Почему именно пятнадцатое? Что ограничивает команду?" },
  { speaker: "Seller" as const, text: "Свободных смен мало, и приёмка новых клиентов занимает неделю." },
  { speaker: "Buyer" as const, text: "Если добавим ночную приёмку, можно вернуть первое октября?" },
  { speaker: "Seller" as const, text: "Ночь возможна, но тогда нужна доплата за смену." },
  { speaker: "Buyer" as const, text: "Доплату обсудим, если зафиксируете объём двести." },
  { speaker: "Seller" as const, text: "Могу двести со старта пятнадцатого и ночной сменой в октябре." },
];

const NORMAL_CONTROL_LINES = [
  { speaker: "Buyer" as const, text: "Нам нужен склад на двести палетомест и запуск первого октября." },
  { speaker: "Seller" as const, text: "Октябрь загружен. Могу сто шестьдесят мест и старт двадцатого." },
  { speaker: "Buyer" as const, text: "Двадцатое ломает нашу отгрузку. Что именно занимает команду?" },
  { speaker: "Seller" as const, text: "Приёмка новых клиентов и ночная инвентаризация. Людей не хватает." },
  { speaker: "Buyer" as const, text: "Если мы отдадим прогноз на три месяца, это снимет риск смен?" },
  { speaker: "Seller" as const, text: "Прогноз поможет. Тогда могу сто восемьдесят мест с десятого." },
  { speaker: "Buyer" as const, text: "Десятое ближе. А если часть объёма пойдёт в соседний корпус?" },
  { speaker: "Seller" as const, text: "Соседний корпус дороже, но старт первого октября реален." },
  { speaker: "Buyer" as const, text: "Тогда давайте пакет: основной корпус плюс двадцать резервных мест." },
  { speaker: "Seller" as const, text: "Согласен, если ночная приёмка оплачивается отдельно и прогноз фиксируется." },
  { speaker: "Buyer" as const, text: "Ночь оплатим при условии, что цена базового места не растёт." },
  { speaker: "Seller" as const, text: "Базовую цену держу. Резерв и ночь — отдельные строки в договоре." },
];

export const SYNTHETIC_SCHEMA_CHARACTERIZATION_FIXTURES: Record<
  CharacterizationFixtureId,
  {
    id: CharacterizationFixtureId;
    context: BuildAnalysisPromptContext;
  }
> = {
  ULTRA_SHORT: {
    id: "ULTRA_SHORT",
    context: buildContext("ULTRA_SHORT", ULTRA_SHORT_LINES),
  },
  SHORT: {
    id: "SHORT",
    context: buildContext("SHORT", SHORT_LINES),
  },
  NORMAL_CONTROL: {
    id: "NORMAL_CONTROL",
    context: buildContext("NORMAL_CONTROL", NORMAL_CONTROL_LINES),
  },
};

export function fixtureTranscriptCharacterCount(
  fixtureId: CharacterizationFixtureId,
): { textChars: number; diarizedChars: number; segmentCount: number } {
  const transcript = SYNTHETIC_SCHEMA_CHARACTERIZATION_FIXTURES[fixtureId].context.transcript;
  return {
    textChars: transcript?.text.length ?? 0,
    diarizedChars: transcript?.diarizedText?.length ?? 0,
    segmentCount: transcript?.segments.length ?? 0,
  };
}

function itemKind(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

export function summarizeMissedOpportunitiesShape(
  parsed: unknown,
): {
  exists: boolean;
  itemKinds: string[];
  shape: MissedOpportunitiesRuntimeShape;
} {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { exists: false, itemKinds: [], shape: "missing" };
  }
  const listening = (parsed as { listeningAndReframing?: unknown }).listeningAndReframing;
  if (!listening || typeof listening !== "object" || Array.isArray(listening)) {
    return { exists: false, itemKinds: [], shape: "missing" };
  }
  if (!("missedOpportunities" in listening)) {
    return { exists: false, itemKinds: [], shape: "missing" };
  }
  const value = (listening as { missedOpportunities?: unknown }).missedOpportunities;
  if (!Array.isArray(value)) {
    return { exists: true, itemKinds: [itemKind(value)], shape: "non_array" };
  }
  if (value.length === 0) {
    return { exists: true, itemKinds: [], shape: "empty_array" };
  }
  const itemKinds = value.map(itemKind);
  const unique = new Set(itemKinds);
  if (unique.size > 1) {
    return { exists: true, itemKinds, shape: "mixed_array" };
  }
  if (unique.has("string")) {
    return { exists: true, itemKinds, shape: "string_array" };
  }
  if (unique.has("object")) {
    return { exists: true, itemKinds, shape: "object_array" };
  }
  if (unique.has("null")) {
    return { exists: true, itemKinds, shape: "null_array" };
  }
  return { exists: true, itemKinds, shape: "unknown" };
}

export function classifySchemaInvalidClass(
  issuePaths: string[],
  issueCodes: string[],
  receivedKinds: Array<string | null>,
): Exclude<InvalidResponseClass, "INVALID_JSON" | null> {
  if (issuePaths.some((path) => path.endsWith(".missedOpportunities"))) {
    if (issuePaths.every((path) => !/\.\d+$/.test(path))) {
      return "MISSING_REQUIRED_KEY";
    }
  }
  if (
    issuePaths.includes(INCIDENT_SCHEMA_ISSUE_PATH) &&
    (issueCodes.includes("invalid_type") ||
      receivedKinds.some((kind) => kind && kind !== "string"))
  ) {
    return "WRONG_ELEMENT_TYPE";
  }
  if (issueCodes.some((code) => code.includes("enum") || code.includes("invalid_value"))) {
    return "WRONG_ENUM";
  }
  if (issuePaths.some((path) => path.split(".").length > 3)) {
    return "WRONG_NESTED_TYPE";
  }
  if (issuePaths.some((path) => !path.includes("."))) {
    return "MISSING_REQUIRED_KEY";
  }
  return "OTHER_SCHEMA";
}

export function classifyParsedAnalysis(parsed: unknown): {
  schemaStatus: "valid" | "invalid";
  output: NegotiationAnalysisOutput | null;
  schemaIssueCount: number;
  schemaIssuePaths: string[];
  invalidClass: InvalidResponseClass;
  incidentPathMatch: boolean;
} {
  const validated = NegotiationAnalysisOutputSchema.safeParse(parsed);
  if (validated.success) {
    return {
      schemaStatus: "valid",
      output: validated.data,
      schemaIssueCount: 0,
      schemaIssuePaths: [],
      invalidClass: null,
      incidentPathMatch: false,
    };
  }
  const bounded = buildBoundedSchemaIssueDiagnostics(validated.error);
  return {
    schemaStatus: "invalid",
    output: null,
    schemaIssueCount: bounded.issueCount,
    schemaIssuePaths: bounded.issuePaths,
    invalidClass: classifySchemaInvalidClass(
      bounded.issuePaths,
      bounded.issueCodes,
      bounded.receivedKinds,
    ),
    incidentPathMatch: bounded.issuePaths.includes(INCIDENT_SCHEMA_ISSUE_PATH),
  };
}

export function classifyProviderCharacterizationError(error: unknown): {
  errorClass: string;
  providerLifecycleResult: string | null;
  outputCondition: string | null;
  incompleteReason: string | null;
  responseLength: number | null;
  parseStatus: CharacterizationGenerationRecord["parseStatus"];
  schemaStatus: CharacterizationGenerationRecord["schemaStatus"];
  schemaIssueCount: number;
  schemaIssuePaths: string[];
  invalidClass: InvalidResponseClass;
  incidentPathMatch: boolean;
} {
  const classified = classifyAiAnalysisError(error);
  const diagnostics = classified.diagnostics;
  const issuePaths = Array.isArray(diagnostics.issuePaths)
    ? diagnostics.issuePaths.filter((path): path is string => typeof path === "string")
    : [];
  const issueCodes = Array.isArray(diagnostics.issueCodes)
    ? diagnostics.issueCodes.filter((code): code is string => typeof code === "string")
    : [];
  const receivedKinds = Array.isArray(diagnostics.receivedKinds)
    ? diagnostics.receivedKinds.map((kind) => (typeof kind === "string" ? kind : null))
    : [];
  const parseStatus =
    classified.code === "MODEL_INVALID_OUTPUT" ? "invalid" : "valid";
  const schemaStatus =
    classified.code === "MODEL_SCHEMA_VALIDATION_ERROR" ? "invalid" : "not_attempted";
  return {
    errorClass: classified.code,
    providerLifecycleResult:
      typeof diagnostics.providerStatus === "string"
        ? diagnostics.providerStatus
        : error instanceof AiAnalysisProviderError
          ? error.code
          : null,
    outputCondition:
      typeof diagnostics.outputCondition === "string"
        ? diagnostics.outputCondition
        : null,
    incompleteReason:
      typeof diagnostics.incompleteReason === "string"
        ? diagnostics.incompleteReason
        : null,
    responseLength:
      typeof diagnostics.responseLength === "number"
        ? diagnostics.responseLength
        : classified.metrics?.responseLength ?? null,
    parseStatus:
      classified.code === "MODEL_SCHEMA_VALIDATION_ERROR" ? "valid" : parseStatus,
    schemaStatus:
      classified.code === "MODEL_INVALID_OUTPUT" ? "not_attempted" : schemaStatus,
    schemaIssueCount:
      typeof diagnostics.issueCount === "number"
        ? diagnostics.issueCount
        : issuePaths.length,
    schemaIssuePaths: issuePaths,
    invalidClass:
      classified.code === "MODEL_INVALID_OUTPUT"
        ? "INVALID_JSON"
        : classified.code === "MODEL_SCHEMA_VALIDATION_ERROR"
          ? classifySchemaInvalidClass(issuePaths, issueCodes, receivedKinds)
          : null,
    incidentPathMatch: issuePaths.includes(INCIDENT_SCHEMA_ISSUE_PATH),
  };
}

export function shouldStopAfterUltraShort(
  records: CharacterizationGenerationRecord[],
): boolean {
  const ultraShortIncident = records.filter(
    (record) =>
      record.fixture === "ULTRA_SHORT" &&
      record.errorClass === "MODEL_SCHEMA_VALIDATION_ERROR" &&
      record.incidentPathMatch &&
      (record.missedOpportunitiesShape === "object_array" ||
        record.invalidClass === "WRONG_ELEMENT_TYPE"),
  );
  return ultraShortIncident.length >= 2;
}

export function summarizeCharacterizationMatrix(
  records: CharacterizationGenerationRecord[],
): Array<{
  fixture: CharacterizationFixtureId;
  runs: number;
  parseValid: number;
  schemaValid: number;
  incidentPathFailures: number;
}> {
  return (["ULTRA_SHORT", "SHORT", "NORMAL_CONTROL"] as const).map((fixture) => {
    const rows = records.filter((record) => record.fixture === fixture);
    return {
      fixture,
      runs: rows.length,
      parseValid: rows.filter((row) => row.parseStatus === "valid").length,
      schemaValid: rows.filter((row) => row.schemaStatus === "valid").length,
      incidentPathFailures: rows.filter((row) => row.incidentPathMatch).length,
    };
  });
}
