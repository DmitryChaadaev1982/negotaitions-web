/**
 * Safe boolean env-var parser.
 *
 * Avoids the JavaScript "truthy string" pitfall where
 * Boolean("false") === true.
 *
 * Recognised truthy values  : "true", "1", "yes", "on"
 * Recognised falsy values   : "false", "0", "no", "off"
 * Missing / empty            : returns defaultValue (default: false)
 */
export function getEnvBoolean(key: string, defaultValue = false): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

/**
 * When true, transcription starts automatically after a recording is
 * marked COMPLETED. When false, transcription must be started manually
 * by the facilitator/host.
 *
 * Controlled by AUTO_TRANSCRIBE_AFTER_RECORDING env variable.
 * Default: false (opt-in, to avoid unexpected OpenAI charges).
 */
export const autoTranscribeAfterRecording = getEnvBoolean(
  "AUTO_TRANSCRIBE_AFTER_RECORDING",
  false,
);
