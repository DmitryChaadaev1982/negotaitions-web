export function getAudioRecordingTargetBitrateKbps() {
  const value = Number(process.env.AUDIO_RECORDING_TARGET_BITRATE_KBPS ?? "32");
  return Number.isFinite(value) && value > 0 ? value : 32;
}

export function getAudioTranscriptionTargetBitrateKbps() {
  const value = Number(process.env.AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS ?? "24");
  return Number.isFinite(value) && value > 0 ? value : 24;
}

export function getAudioTranscriptionSampleRate() {
  const value = Number(process.env.AUDIO_TRANSCRIPTION_SAMPLE_RATE ?? "16000");
  return Number.isFinite(value) && value > 0 ? value : 16000;
}

export function getAudioTranscriptionChannels() {
  const value = Number(process.env.AUDIO_TRANSCRIPTION_CHANNELS ?? "1");
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function getAudioTranscriptionMaxFileBytes() {
  const mb = Number(process.env.AUDIO_TRANSCRIPTION_MAX_FILE_MB ?? "24");
  const safeMb = Number.isFinite(mb) && mb > 0 ? mb : 24;
  return safeMb * 1024 * 1024;
}
