import type {
  EmailMessageCategory,
  EmailMessageStatus,
  EmailMessageType,
  EmailProviderEventType,
  EmailSuppressionReason,
} from "@/app/generated/prisma/client";

export type EmailLocale = "ru" | "en";

export function parseEmailLocaleStrict(value: unknown): EmailLocale | null {
  return value === "ru" || value === "en" ? value : null;
}

export type EmailTemplateKey =
  | "system-test"
  | "password-reset"
  | "account-recovery-denied"
  | "password-changed"
  | "event-invitation"
  | "session-invitation"
  | "admin-pending-approval";

export type TemplateVariableType = "string" | "url";

export type TemplateVariableDefinition = {
  name: string;
  type: TemplateVariableType;
  required: boolean;
};

export type EmailTemplateMetadata = {
  key: EmailTemplateKey;
  version: string;
  locale: EmailLocale;
  messageType: EmailMessageType;
  category: EmailMessageCategory;
  description: string;
  variables: TemplateVariableDefinition[];
  defaultSender: "no-reply" | "notifications" | "invitations";
  defaultReplyTo: "support" | "security" | "business";
  footerKey: "operational";
  sensitive: boolean;
  futureStage: "3.13B" | "3.13C" | "3.13D";
  runtimeEnabled: boolean;
};

export type LoadedEmailTemplate = {
  metadata: EmailTemplateMetadata;
  subject: string;
  text: string;
  html: string;
};

export type RenderedEmailTemplate = {
  subject: string;
  textBody: string;
  htmlBody: string;
  templateVersion: string;
};

export type EmailProviderSendInput = {
  id: string;
  recipientEmail: string;
  fromAddress: string;
  replyToAddress: string | null;
  subject: string;
  textBody: string;
  htmlBody: string;
  idempotencyKey: string;
};

export type EmailProviderSendResult =
  | {
      ok: true;
      providerName: string;
      transport: string;
      providerMessageId: string;
      acceptedAt: Date;
      metadata?: Record<string, unknown>;
    }
  | {
      ok: false;
      providerName: string;
      transport: string;
      retryable: boolean;
      acceptanceUnknown?: boolean;
      errorCode: string;
      sanitizedMessage: string;
      metadata?: Record<string, unknown>;
    };

export interface EmailProvider {
  readonly name: string;
  readonly transport: string;
  send(input: EmailProviderSendInput): Promise<EmailProviderSendResult>;
}

export type EnqueueEmailInput = {
  /** Optional preallocated id (required for sensitive AAD-bound payloads). */
  id?: string;
  messageType: EmailMessageType;
  category: EmailMessageCategory;
  recipientEmail: string;
  userId?: string | null;
  locale?: EmailLocale | string | null;
  templateKey: EmailTemplateKey;
  variables: Record<string, string>;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  /** When true, do not persist rendered bodies containing secrets. */
  deferSensitiveRender?: boolean;
  sensitivePayload?: { ciphertext: string; nonce: string };
  relatedTokenId?: string | null;
};

export type EnqueueEmailResult =
  | {
      created: true;
      suppressed: false;
      duplicate: false;
      messageId: string;
      status: EmailMessageStatus;
    }
  | {
      created: false;
      suppressed: false;
      duplicate: true;
      messageId: string;
      status: EmailMessageStatus;
    }
  | {
      created: true;
      suppressed: true;
      duplicate: false;
      messageId: string;
      status: EmailMessageStatus;
    }
  | {
      created: false;
      suppressed: true;
      duplicate: true;
      messageId: string;
      status: EmailMessageStatus;
    };

export type NormalizedProviderEventInput = {
  provider: string;
  providerEventId: string;
  providerMessageId?: string | null;
  eventType: EmailProviderEventType;
  eventTime: Date;
  metadata?: Record<string, unknown>;
  suppressionReason?: EmailSuppressionReason | null;
};
