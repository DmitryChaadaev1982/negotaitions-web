import { getFfmpegStatus, isFfmpegAvailable } from "@/lib/audio/compress";
import { getLiveKitConfig } from "@/lib/livekit";
import { createEgressClient } from "@/lib/livekit-egress";
import { checkOpenAiHealth, isOpenAiConfigured } from "@/lib/services/openai-transcription";
import { checkStorageHealth } from "@/lib/storage/s3";

export function getEnvironmentConfigStatus() {
  return {
    livekitUrl: Boolean(process.env.LIVEKIT_URL?.trim()),
    livekitApiKey: Boolean(process.env.LIVEKIT_API_KEY?.trim()),
    livekitApiSecret: Boolean(process.env.LIVEKIT_API_SECRET?.trim()),
    s3Bucket: Boolean(process.env.S3_BUCKET?.trim()),
    s3Region: Boolean(process.env.S3_REGION?.trim()),
    s3Endpoint: Boolean(process.env.S3_ENDPOINT?.trim()),
    s3AccessKeyId: Boolean(process.env.S3_ACCESS_KEY_ID?.trim()),
    s3SecretAccessKey: Boolean(process.env.S3_SECRET_ACCESS_KEY?.trim()),
    openAiApiKey: isOpenAiConfigured(),
    ffmpeg: getFfmpegStatus(),
  };
}

export async function checkLiveKitHealth() {
  const config = getLiveKitConfig();
  if (!config) {
    return {
      ok: false,
      message: "LiveKit recording is not configured.",
    };
  }

  try {
    createEgressClient();
    return {
      ok: true,
      message: "LiveKit client initialized successfully.",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "LiveKit check failed.",
    };
  }
}

export async function getAdminHealthSummary() {
  const config = getEnvironmentConfigStatus();

  return {
    config,
    hasRecentServiceErrors: false,
  };
}

export { checkStorageHealth, checkOpenAiHealth, isFfmpegAvailable, getFfmpegStatus };
