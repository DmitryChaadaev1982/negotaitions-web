type ProbeLike = {
  container?: string | null;
  codec?: string | null;
  sampleRate?: number | null;
  channels?: number | null;
  probeAvailable?: boolean;
};

const SUPPORTED_CONTAINER_EXTENSIONS = [".mp3", ".wav", ".ogg", ".opus", ".webm", ".flac"];
const SUPPORTED_CONTAINER_TOKENS = ["mp3", "wav", "ogg", "opus", "webm", "matroska", "flac"];
const SUPPORTED_CODECS = ["mp3", "pcm_s16le", "pcm", "opus", "vorbis", "flac"];

function normalizeLower(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function hasCompatibleFileExtension(fileName: string | null | undefined): boolean {
  const normalized = normalizeLower(fileName);
  if (!normalized) return false;
  return SUPPORTED_CONTAINER_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

function hasCompatibleProbeContainer(container: string | null | undefined): boolean {
  const normalized = normalizeLower(container);
  if (!normalized) return false;
  return SUPPORTED_CONTAINER_TOKENS.some((token) => normalized.includes(token));
}

function hasCompatibleProbeCodec(codec: string | null | undefined): boolean {
  const normalized = normalizeLower(codec);
  if (!normalized) return false;
  return SUPPORTED_CODECS.some((supported) => normalized.includes(supported));
}

export function isSpeechKitContainerCompatible(fileName: string) {
  return hasCompatibleFileExtension(fileName);
}

export function evaluateSpeechKitCompatibility(params: {
  inputFileName?: string | null;
  probe?: ProbeLike | null;
}) {
  const hasCompatibleExtension = hasCompatibleFileExtension(params.inputFileName);
  const probeContainerCompatible = hasCompatibleProbeContainer(params.probe?.container);
  const probeCodecCompatible = hasCompatibleProbeCodec(params.probe?.codec);
  const probeAvailable = params.probe?.probeAvailable === true;
  const isCompatible =
    (probeAvailable && probeContainerCompatible && probeCodecCompatible) ||
    (!probeAvailable && hasCompatibleExtension) ||
    (probeAvailable && probeContainerCompatible && !params.probe?.codec);

  return {
    isCompatible,
    probeAvailable,
    hasCompatibleExtension,
    probeContainerCompatible,
    probeCodecCompatible,
    reason: isCompatible
      ? "compatible"
      : probeAvailable
        ? "incompatible_probe_container_or_codec"
        : "incompatible_filename_extension",
  };
}

export function shouldReuseOriginalAudioForTranscription(
  inputSizeBytes: number,
  inputFileName: string,
  maxBytes: number,
  probe?: ProbeLike | null,
) {
  const isUnderCompressionThreshold = inputSizeBytes <= maxBytes;
  const compatibility = evaluateSpeechKitCompatibility({
    inputFileName,
    probe,
  });

  return {
    shouldReuseOriginal: isUnderCompressionThreshold && compatibility.isCompatible,
    isUnderCompressionThreshold,
    isContainerCompatible: compatibility.isCompatible,
    thresholdBytes: maxBytes,
    compatibilityReason: compatibility.reason,
    probeAvailable: compatibility.probeAvailable,
  };
}
