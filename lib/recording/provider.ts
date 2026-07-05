import { getVideoProvider } from "@/lib/env";

export type EffectiveRecordingProvider = "livekit" | "voximplant";

function normalizeProvider(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export function isVoximplantRecordingProvider(
  provider: string | null | undefined,
): boolean {
  const normalized = normalizeProvider(provider);
  return normalized.includes("VOXIMPLANT");
}

export function isLiveKitRecordingProvider(
  provider: string | null | undefined,
): boolean {
  const normalized = normalizeProvider(provider);
  return normalized.includes("LIVEKIT");
}

export function resolveEffectiveRecordingProvider(
  recordingProvider?: string | null,
): EffectiveRecordingProvider {
  if (isVoximplantRecordingProvider(recordingProvider)) {
    return "voximplant";
  }
  if (isLiveKitRecordingProvider(recordingProvider)) {
    return "livekit";
  }
  return getVideoProvider() === "voximplant" ? "voximplant" : "livekit";
}
