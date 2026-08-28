import {
  SOURCE_RECORDING_NOT_AVAILABLE_CODE,
} from "@/lib/services/source-recording-not-available";
import type { TranslationKey } from "@/lib/i18n/translate";

export function isSourceRecordingNotAvailableCode(
  code: unknown,
): code is typeof SOURCE_RECORDING_NOT_AVAILABLE_CODE {
  return code === SOURCE_RECORDING_NOT_AVAILABLE_CODE;
}

export function resolveRetranscribeFailureMessage(
  body: { error?: string; code?: string },
  t: (key: TranslationKey) => string,
  fallback: string,
): string {
  if (isSourceRecordingNotAvailableCode(body.code)) {
    return t("recording.sourceRecordingNotAvailable");
  }
  const message = body.error?.trim();
  return message || fallback;
}
