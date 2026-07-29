import type { RecordingControlMessage } from "@/lib/voximplant/scenario-messages";

export function resolveScenarioMessageTextForRelay(input: {
  scenarioMessageText?: string | null;
  scenarioMessage?: RecordingControlMessage | null;
}): string | null {
  const directText =
    typeof input.scenarioMessageText === "string"
      ? input.scenarioMessageText.trim()
      : "";
  if (directText) {
    return directText;
  }
  if (input.scenarioMessage) {
    return JSON.stringify(input.scenarioMessage);
  }
  return null;
}
