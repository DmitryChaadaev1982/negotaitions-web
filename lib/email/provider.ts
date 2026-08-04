import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";

import { getEmailConfig } from "@/lib/email/config";
import type {
  EmailProvider,
  EmailProviderSendInput,
  EmailProviderSendResult,
} from "@/lib/email/types";

export class DisabledEmailProvider implements EmailProvider {
  readonly name = "disabled";
  readonly transport = "none";

  async send(): Promise<EmailProviderSendResult> {
    return {
      ok: false,
      providerName: this.name,
      transport: this.transport,
      retryable: false,
      errorCode: "EMAIL_DELIVERY_DISABLED",
      sanitizedMessage: "Email delivery is disabled.",
    };
  }
}

export class FakeEmailProvider implements EmailProvider {
  readonly name = "fake";
  readonly transport = "memory";
  readonly sent: EmailProviderSendInput[] = [];

  async send(input: EmailProviderSendInput): Promise<EmailProviderSendResult> {
    this.sent.push(input);
    return {
      ok: true,
      providerName: this.name,
      transport: this.transport,
      providerMessageId: `fake-${input.id}`,
      acceptedAt: new Date(),
    };
  }
}

export class YandexPostboxEmailProvider implements EmailProvider {
  readonly name = "yandex_postbox";
  readonly transport = "sesv2_api";
  private readonly client: SESv2Client;
  private readonly configurationSetName: string | null;

  constructor(config = getEmailConfig()) {
    const { accessKeyId, secretAccessKey, region, endpoint, configurationSetName } =
      config.yandexPostbox;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("Missing Yandex Postbox credentials.");
    }
    this.configurationSetName = configurationSetName;
    this.client = new SESv2Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async send(input: EmailProviderSendInput): Promise<EmailProviderSendResult> {
    const payload: SendEmailCommandInput = {
      FromEmailAddress: input.fromAddress,
      Destination: { ToAddresses: [input.recipientEmail] },
      Content: {
        Simple: {
          Subject: { Data: input.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: input.textBody, Charset: "UTF-8" },
            Html: { Data: input.htmlBody, Charset: "UTF-8" },
          },
        },
      },
      EmailTags: [{ Name: "email_message_id", Value: input.id }],
    };
    if (input.replyToAddress) {
      payload.ReplyToAddresses = [input.replyToAddress];
    }
    if (this.configurationSetName) {
      payload.ConfigurationSetName = this.configurationSetName;
    }

    try {
      const result = await this.client.send(new SendEmailCommand(payload));
      if (!result.MessageId) {
        return {
          ok: false,
          providerName: this.name,
          transport: this.transport,
          retryable: true,
          timeoutUnknown: true,
          errorCode: "PROVIDER_ACCEPTANCE_UNKNOWN",
          sanitizedMessage: "Provider response did not include a message id.",
        };
      }
      return {
        ok: true,
        providerName: this.name,
        transport: this.transport,
        providerMessageId: result.MessageId,
        acceptedAt: new Date(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider send failed.";
      const lower = message.toLowerCase();
      const retryable =
        lower.includes("timeout") ||
        lower.includes("rate") ||
        lower.includes("temporar") ||
        lower.includes("throttl") ||
        lower.includes("5");
      return {
        ok: false,
        providerName: this.name,
        transport: this.transport,
        retryable,
        errorCode: retryable ? "PROVIDER_RETRYABLE_FAILURE" : "PROVIDER_FINAL_FAILURE",
        sanitizedMessage: message.slice(0, 500),
      };
    }
  }
}

export function createEmailProvider(): EmailProvider {
  const config = getEmailConfig();
  if (!config.deliveryEnabled || config.provider === "disabled") {
    return new DisabledEmailProvider();
  }
  if (config.provider === "fake") {
    return new FakeEmailProvider();
  }
  return new YandexPostboxEmailProvider(config);
}
