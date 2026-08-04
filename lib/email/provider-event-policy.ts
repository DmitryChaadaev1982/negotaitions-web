import {
  EmailMessageStatus,
  EmailProviderEventType,
} from "@/app/generated/prisma/client";

export type ProviderEventTransitionDecision =
  | {
      apply: true;
      nextStatus: EmailMessageStatus;
      resultCode: "APPLIED";
      resultMessage: string;
    }
  | {
      apply: false;
      resultCode:
        | "UNKNOWN_EVENT_TYPE"
        | "OLDER_EVENT_IGNORED"
        | "WEAKER_EVENT_IGNORED"
        | "TERMINAL_STATE_IGNORED";
      resultMessage: string;
    };

const TERMINAL_APPLICATION_STATES = new Set<EmailMessageStatus>([
  EmailMessageStatus.SUPPRESSED,
  EmailMessageStatus.CANCELLED,
  EmailMessageStatus.COMPLAINED,
]);

function statusForProviderEvent(eventType: EmailProviderEventType): EmailMessageStatus | null {
  switch (eventType) {
    case EmailProviderEventType.ACCEPTED:
      return EmailMessageStatus.ACCEPTED_BY_PROVIDER;
    case EmailProviderEventType.DELAYED:
      return EmailMessageStatus.DELAYED;
    case EmailProviderEventType.DELIVERED:
      return EmailMessageStatus.DELIVERED;
    case EmailProviderEventType.BOUNCED:
      return EmailMessageStatus.BOUNCED;
    case EmailProviderEventType.COMPLAINED:
      return EmailMessageStatus.COMPLAINED;
    case EmailProviderEventType.REJECTED:
    case EmailProviderEventType.RENDERING_FAILED:
      return EmailMessageStatus.FAILED_FINAL;
    case EmailProviderEventType.UNKNOWN:
      return null;
  }
}

function strength(status: EmailMessageStatus): number {
  switch (status) {
    case EmailMessageStatus.ACCEPTED_BY_PROVIDER:
      return 10;
    case EmailMessageStatus.ACCEPTANCE_UNKNOWN:
      return 15;
    case EmailMessageStatus.DELAYED:
      return 20;
    case EmailMessageStatus.DELIVERED:
      return 30;
    case EmailMessageStatus.FAILED_FINAL:
      return 40;
    case EmailMessageStatus.BOUNCED:
      return 50;
    case EmailMessageStatus.COMPLAINED:
      return 60;
    default:
      return 0;
  }
}

export function evaluateProviderEventTransition(params: {
  currentStatus: EmailMessageStatus;
  lastProviderEventTime: Date | null;
  eventType: EmailProviderEventType;
  eventTime: Date;
}): ProviderEventTransitionDecision {
  const nextStatus = statusForProviderEvent(params.eventType);
  if (!nextStatus) {
    return {
      apply: false,
      resultCode: "UNKNOWN_EVENT_TYPE",
      resultMessage: "Provider event type is recorded but does not change message state.",
    };
  }

  if (params.lastProviderEventTime && params.eventTime < params.lastProviderEventTime) {
    return {
      apply: false,
      resultCode: "OLDER_EVENT_IGNORED",
      resultMessage: "Provider event is older than the last applied provider event.",
    };
  }

  if (TERMINAL_APPLICATION_STATES.has(params.currentStatus)) {
    return {
      apply: false,
      resultCode: "TERMINAL_STATE_IGNORED",
      resultMessage: "Provider event cannot change a terminal message state.",
    };
  }

  if (
    params.currentStatus !== EmailMessageStatus.ACCEPTANCE_UNKNOWN &&
    strength(nextStatus) < strength(params.currentStatus)
  ) {
    return {
      apply: false,
      resultCode: "WEAKER_EVENT_IGNORED",
      resultMessage: "Provider event would downgrade the message state.",
    };
  }

  return {
    apply: true,
    nextStatus,
    resultCode: "APPLIED",
    resultMessage: "Provider event transition applied.",
  };
}
