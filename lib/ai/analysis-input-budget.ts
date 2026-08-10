/**
 * Conservative application budget for the complete provider input.
 *
 * Yandex's model catalog confirms the selected DeepSeek model but does not
 * expose a context-window value. Keep a large safety margin instead of relying
 * on an undocumented Yandex provider limit. The estimate intentionally remains
 * the same simple chars/4 approximation used by existing Yandex diagnostics.
 */
export const YANDEX_DEEPSEEK_ANALYSIS_TOTAL_INPUT_TOKEN_BUDGET = 100_000;
export const YANDEX_DEEPSEEK_ANALYSIS_INSTRUCTION_TOKEN_RESERVE = 10_000;
export const YANDEX_DEEPSEEK_ANALYSIS_PROMPT_TOKEN_BUDGET =
  YANDEX_DEEPSEEK_ANALYSIS_TOTAL_INPUT_TOKEN_BUDGET -
  YANDEX_DEEPSEEK_ANALYSIS_INSTRUCTION_TOKEN_RESERVE;

export function estimateAiAnalysisTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}
