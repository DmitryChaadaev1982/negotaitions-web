import { ExternalService, ExternalServiceEventSeverity } from "@/app/generated/prisma/client";
import { redactEmail } from "@/lib/email/address";
import { logExternalServiceEvent } from "@/lib/services/external-service-events";

type EmailLogLevel = "info" | "warn" | "error";

export function logEmailEvent(
  level: EmailLogLevel,
  event: string,
  data: Record<string, unknown>,
) {
  const payload = JSON.stringify({
    area: "email_foundation",
    event,
    level,
    ...data,
  });
  if (level === "error") {
    console.error(payload);
  } else if (level === "warn") {
    console.warn(payload);
  } else {
    console.log(payload);
  }
}

export function safeRecipient(value: string | null | undefined) {
  return redactEmail(value);
}

export async function logEmailConfigurationFailure(message: string, requestId?: string) {
  await logExternalServiceEvent({
    service: ExternalService.EMAIL,
    severity: ExternalServiceEventSeverity.ERROR,
    errorCode: "CONFIG_MISSING",
    title: "Email delivery configuration failure",
    message,
    requestId,
  }).catch(() => null);
}
