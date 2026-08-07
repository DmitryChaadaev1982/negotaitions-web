/**
 * Synthetic contract fixtures for the Yandex AI Studio Responses endpoint.
 * No fixture contains production prompts, transcript text, response bodies, or
 * identifiers.
 */
export const yandexResponseLifecycleFixtures = {
  completed(outputText: string) {
    return {
      id: "resp_synthetic_completed",
      object: "response",
      status: "completed",
      output_text: outputText,
    };
  },
  queued: {
    id: "resp_synthetic_queued",
    object: "response",
    status: "queued",
    output: [],
  },
  inProgress: {
    id: "resp_synthetic_in_progress",
    object: "response",
    status: "in_progress",
    output: [],
  },
  inProgressWithPartialText: {
    id: "resp_synthetic_partial",
    object: "response",
    status: "in_progress",
    output_text: "{\"partial\":true",
  },
  completedEmpty: {
    id: "resp_synthetic_empty",
    object: "response",
    status: "completed",
    output: [],
  },
  failed: {
    id: "resp_synthetic_failed",
    object: "response",
    status: "failed",
    error: { code: "server_error", message: "Synthetic provider failure." },
    output_text: "{\"partial\":true",
  },
  cancelled: {
    id: "resp_synthetic_cancelled",
    object: "response",
    status: "cancelled",
    output: [],
  },
  incomplete: {
    id: "resp_synthetic_incomplete",
    object: "response",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output_text: "{\"partial\":true",
  },
  unknown: {
    id: "resp_synthetic_unknown",
    object: "response",
    status: "synthetic_future_state",
    output: [],
  },
  nonterminalWithoutId: {
    object: "response",
    status: "in_progress",
    output: [],
  },
} as const;
