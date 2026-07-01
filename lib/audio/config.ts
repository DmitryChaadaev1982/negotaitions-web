export type AudioTranscriptionQualityProfile =
  | "standard"
  | "high"
  | "diagnostic";

function parsePositiveNumber(rawValue: string | undefined, fallback: number) {
  const value = Number(rawValue ?? String(fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getProfileDefaultBitrateKbps(profile: AudioTranscriptionQualityProfile) {
  if (profile === "high") return 96;
  if (profile === "diagnostic") return 128;
  return 24;
}

function getProfileDefaultSampleRate(profile: AudioTranscriptionQualityProfile) {
  if (profile === "high" || profile === "diagnostic") return 48000;
  return 16000;
}

function getProfileDefaultChannels() {
  return 1;
}

function getProfileDefaultMaxFileMb(profile: AudioTranscriptionQualityProfile) {
  if (profile === "high" || profile === "diagnostic") return 100;
  return 24;
}

export function getAudioTranscriptionQualityProfile(): AudioTranscriptionQualityProfile {
  const raw = process.env.AUDIO_TRANSCRIPTION_QUALITY_PROFILE?.trim().toLowerCase();
  if (raw === "high") return "high";
  if (raw === "diagnostic") return "diagnostic";
  return "standard";
}

export function getAudioRecordingTargetBitrateKbps() {
  return parsePositiveNumber(process.env.AUDIO_RECORDING_TARGET_BITRATE_KBPS, 32);
}

export function getAudioTranscriptionTargetBitrateKbps() {
  const profile = getAudioTranscriptionQualityProfile();
  return parsePositiveNumber(
    process.env.AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS,
    getProfileDefaultBitrateKbps(profile),
  );
}

export function getAudioTranscriptionSampleRate() {
  const profile = getAudioTranscriptionQualityProfile();
  return parsePositiveNumber(
    process.env.AUDIO_TRANSCRIPTION_SAMPLE_RATE,
    getProfileDefaultSampleRate(profile),
  );
}

export function getAudioTranscriptionChannels() {
  return parsePositiveNumber(
    process.env.AUDIO_TRANSCRIPTION_CHANNELS,
    getProfileDefaultChannels(),
  );
}

export function getAudioTranscriptionMaxFileBytes() {
  const profile = getAudioTranscriptionQualityProfile();
  const safeMb = parsePositiveNumber(
    process.env.AUDIO_TRANSCRIPTION_MAX_FILE_MB,
    getProfileDefaultMaxFileMb(profile),
  );
  return safeMb * 1024 * 1024;
}
