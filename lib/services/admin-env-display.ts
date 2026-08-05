import {
  getAiAnalysisProvider,
  getTranscriptionProvider,
  getVideoProvider,
} from "@/lib/env";

export type AdminEnvDisplayItem = {
  key: string;
  configured: boolean;
  isSecret: boolean;
  value: string | null;
};

export type AdminEnvDisplayGroup = {
  group: string | null;
  items: AdminEnvDisplayItem[];
};

export function maskSecretValue(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "********";
  if (normalized.length <= 4) {
    return `${normalized.slice(0, 1)}********`;
  }
  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}********`;
  }
  return `${normalized.slice(0, 3)}********${normalized.slice(-3)}`;
}

function readEnv(key: string): string | null {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

function toDisplayItem(key: string, isSecret: boolean): AdminEnvDisplayItem {
  const raw = readEnv(key);
  return {
    key,
    configured: Boolean(raw),
    isSecret,
    value: raw ? (isSecret ? maskSecretValue(raw) : raw) : null,
  };
}

export function getAdminEnvironmentDisplayGroups(): AdminEnvDisplayGroup[] {
  const groups: AdminEnvDisplayGroup[] = [
    {
      // Variables that do not belong to one provider-domain group.
      group: null,
      items: [
        {
          key: "VIDEO_PROVIDER",
          configured: true,
          isSecret: false,
          value: getVideoProvider(),
        },
        {
          key: "TRANSCRIPTION_PROVIDER",
          configured: true,
          isSecret: false,
          value: getTranscriptionProvider(),
        },
        {
          key: "AI_ANALYSIS_PROVIDER",
          configured: true,
          isSecret: false,
          value: getAiAnalysisProvider(),
        },
      ],
    },
    {
      group: "Voximplant",
      items: [
        toDisplayItem("VOXIMPLANT_ACCOUNT_NAME", false),
        toDisplayItem("VOXIMPLANT_APPLICATION_NAME", false),
        toDisplayItem("VOXIMPLANT_USER_DOMAIN", false),
        toDisplayItem("VOXIMPLANT_SCENARIO_NAME", false),
        toDisplayItem("VOXIMPLANT_RULE_NAME", false),
        toDisplayItem("VOXIMPLANT_API_KEY", true),
        toDisplayItem("VOXIMPLANT_API_KEY_PATH", false),
        toDisplayItem("VOXIMPLANT_MANAGEMENT_ACCOUNT_ID", false),
        toDisplayItem("VOXIMPLANT_MANAGEMENT_APPLICATION_ID", false),
        toDisplayItem("VOXIMPLANT_RECORDING_ENABLED", false),
        toDisplayItem("VOXIMPLANT_RECORDING_AUDIO_ONLY", false),
        toDisplayItem("VOXIMPLANT_RECORDING_AUDIO_MODE", false),
        toDisplayItem("VOXIMPLANT_RECORDING_STORAGE", false),
        toDisplayItem("VOXIMPLANT_RECORDING_WEBHOOK_SECRET", true),
        toDisplayItem("VOXIMPLANT_RECORDING_CONTROL_SECRET", true),
        toDisplayItem("VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL", false),
        toDisplayItem("VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED", false),
      ],
    },
    {
      group: "LiveKit",
      items: [
        toDisplayItem("LIVEKIT_URL", false),
        toDisplayItem("LIVEKIT_API_KEY", true),
        toDisplayItem("LIVEKIT_API_SECRET", true),
      ],
    },
    {
      group: "Yandex SpeechKit",
      items: [
        toDisplayItem("YANDEX_FOLDER_ID", false),
        toDisplayItem("YANDEX_API_KEY", true),
        toDisplayItem("YANDEX_SPEECHKIT_MODEL", false),
        toDisplayItem("YANDEX_SPEECHKIT_LANGUAGE", false),
        toDisplayItem("YANDEX_SPEECHKIT_TEXT_NORMALIZATION_ENABLED", false),
        toDisplayItem("YANDEX_SPEECHKIT_LITERATURE_TEXT", false),
        toDisplayItem("YANDEX_SPEECHKIT_ENABLE_SPEAKER_LABELING", false),
        toDisplayItem("YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED", false),
        toDisplayItem("TRANSCRIPT_ENHANCEMENT_AUTO_RUN", false),
        toDisplayItem("TRANSCRIPT_ENHANCEMENT_MODE", false),
        toDisplayItem("TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE", false),
        toDisplayItem("TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS", false),
        toDisplayItem("TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS", false),
        toDisplayItem("TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY", false),
        toDisplayItem("TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS", false),
        toDisplayItem("TRANSCRIPT_ENHANCEMENT_MAX_RETRIES", false),
        toDisplayItem("TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL", false),
        {
          key: "YANDEX_SPEECHKIT_REQUIRED_KEYS_PRESENT",
          configured: Boolean(readEnv("YANDEX_FOLDER_ID") && readEnv("YANDEX_API_KEY")),
          isSecret: false,
          value:
            readEnv("YANDEX_FOLDER_ID") && readEnv("YANDEX_API_KEY")
              ? "true"
              : "false",
        },
      ],
    },
    {
      group: "Yandex AI / DeepSeek",
      items: [
        toDisplayItem("OPENAI_API_KEY", true),
        toDisplayItem("YANDEX_AI_MODEL", false),
        toDisplayItem("YANDEX_DEEPSEEK_API_KEY", true),
      ],
    },
    {
      group: "Recording / Audio",
      items: [
        toDisplayItem("S3_BUCKET", false),
        toDisplayItem("S3_REGION", false),
        toDisplayItem("S3_ENDPOINT", false),
        toDisplayItem("S3_ACCESS_KEY_ID", true),
        toDisplayItem("S3_SECRET_ACCESS_KEY", true),
        toDisplayItem("FFMPEG_BIN", false),
      ],
    },
    {
      group: "Database / Auth",
      items: [
        toDisplayItem("DATABASE_URL", true),
        toDisplayItem("ADMIN_EMAILS", false),
      ],
    },
    {
      group: "Email foundation",
      items: [
        toDisplayItem("EMAIL_DELIVERY_ENABLED", false),
        toDisplayItem("EMAIL_PROVIDER", false),
        toDisplayItem("EMAIL_CANONICAL_BASE_URL", false),
        toDisplayItem("EMAIL_FROM_NO_REPLY", false),
        toDisplayItem("EMAIL_FROM_NOTIFICATIONS", false),
        toDisplayItem("EMAIL_FROM_INVITATIONS", false),
        toDisplayItem("EMAIL_REPLY_TO_SUPPORT", false),
        toDisplayItem("EMAIL_REPLY_TO_SECURITY", false),
        toDisplayItem("EMAIL_REPLY_TO_BUSINESS", false),
        toDisplayItem("EMAIL_OPERATOR_NAME", false),
        toDisplayItem("EMAIL_WORKER_BATCH_SIZE", false),
        toDisplayItem("EMAIL_MAX_ATTEMPTS", false),
        toDisplayItem("EMAIL_RETRY_BASE_SECONDS", false),
        toDisplayItem("EMAIL_RETRY_MAX_SECONDS", false),
        toDisplayItem("EMAIL_PROCESSING_LEASE_SECONDS", false),
        toDisplayItem("EMAIL_CONTENT_RETENTION_DAYS", false),
        toDisplayItem("EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS", false),
        toDisplayItem("EMAIL_PROVIDER_ID_RETENTION_DAYS", false),
        toDisplayItem("EMAIL_PROVIDER_EVENT_RETENTION_DAYS", false),
        toDisplayItem("EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS", false),
        toDisplayItem("EMAIL_ADMIN_TEST_ENABLED", false),
        toDisplayItem("EMAIL_LOCAL_PREVIEW_ENABLED", false),
        toDisplayItem("TRUSTED_PROXY_ENABLED", false),
        toDisplayItem("PASSWORD_RESET_TOKEN_TTL_MINUTES", false),
        toDisplayItem("PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS", false),
        toDisplayItem("PASSWORD_RESET_MAX_REQUESTS_PER_HOUR", false),
        toDisplayItem("YANDEX_POSTBOX_REGION", false),
        toDisplayItem("YANDEX_POSTBOX_ENDPOINT", false),
        toDisplayItem("YANDEX_POSTBOX_CONFIGURATION_SET", false),
        toDisplayItem("YANDEX_POSTBOX_ACCESS_KEY_ID", true),
        toDisplayItem("YANDEX_POSTBOX_SECRET_ACCESS_KEY", true),
      ],
    },
    {
      group: "Debug / Admin",
      items: [
        toDisplayItem("NODE_ENV", false),
        toDisplayItem("NEXT_PUBLIC_APP_URL", false),
        toDisplayItem("NEXT_PUBLIC_RECORDING_DEBUG_PANEL", false),
      ],
    },
  ];

  const seen = new Set<string>();
  return groups.map((group) => ({
    group: group.group,
    items: group.items.filter((item) => {
      if (seen.has(item.key)) {
        return false;
      }
      seen.add(item.key);
      return true;
    }),
  }));
}
