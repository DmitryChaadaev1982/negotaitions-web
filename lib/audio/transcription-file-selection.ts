export function isSpeechKitContainerCompatible(fileName: string) {
  const normalized = fileName.toLowerCase();
  return (
    normalized.endsWith(".mp3") ||
    normalized.endsWith(".wav") ||
    normalized.endsWith(".ogg") ||
    normalized.endsWith(".opus") ||
    normalized.endsWith(".webm")
  );
}

export function shouldReuseOriginalAudioForTranscription(
  inputSizeBytes: number,
  inputFileName: string,
  maxBytes: number,
) {
  const isUnderCompressionThreshold = inputSizeBytes <= maxBytes;
  const isContainerCompatible = isSpeechKitContainerCompatible(inputFileName);

  return {
    shouldReuseOriginal:
      isUnderCompressionThreshold && isContainerCompatible,
    isUnderCompressionThreshold,
    isContainerCompatible,
    thresholdBytes: maxBytes,
  };
}
