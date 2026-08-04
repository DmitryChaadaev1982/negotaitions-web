export type EmailProviderErrorCategory =
  | "RETRYABLE_THROTTLE"
  | "RETRYABLE_SERVER_ERROR"
  | "RETRYABLE_NETWORK"
  | "ACCEPTANCE_UNKNOWN"
  | "INVALID_RECIPIENT"
  | "INVALID_SENDER"
  | "ACCESS_DENIED"
  | "CONFIGURATION_ERROR"
  | "VALIDATION_ERROR"
  | "PROVIDER_FINAL_FAILURE"
  | "UNKNOWN_PROVIDER_FAILURE";

export type ProviderErrorClassification = {
  category: EmailProviderErrorCategory;
  retryable: boolean;
  acceptanceUnknown: boolean;
  normalizedCode: string;
  sanitizedMessage: string;
};

type StructuredProviderError = {
  name?: unknown;
  code?: unknown;
  Code?: unknown;
  $metadata?: { httpStatusCode?: unknown };
  $retryable?: { throttling?: unknown } | boolean;
};

const NETWORK_ERROR_NAMES = new Set([
  "AbortError",
  "TimeoutError",
  "TimeoutErrorException",
  "RequestTimeout",
  "NetworkingError",
  "ConnectionError",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
]);

const INVALID_RECIPIENT_NAMES = new Set([
  "MessageRejected",
  "MailFromDomainNotVerifiedException",
  "AccountSuspendedException",
]);

const INVALID_SENDER_NAMES = new Set([
  "SendingPausedException",
  "FromEmailAddressNotVerifiedException",
  "MailFromDomainNotVerified",
]);

const ACCESS_DENIED_NAMES = new Set([
  "AccessDenied",
  "AccessDeniedException",
  "UnauthorizedOperation",
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "SignatureDoesNotMatch",
]);

const CONFIGURATION_NAMES = new Set([
  "ConfigurationSetDoesNotExistException",
  "NotFoundException",
]);

const VALIDATION_NAMES = new Set([
  "BadRequestException",
  "ValidationException",
  "InvalidParameterValue",
  "InvalidParameterValueException",
]);

function asStructured(error: unknown): StructuredProviderError {
  if (typeof error !== "object" || error === null) return {};
  return error as StructuredProviderError;
}

function stableName(error: StructuredProviderError): string {
  const value = error.name ?? error.code ?? error.Code;
  return typeof value === "string" && value.trim() ? value.trim() : "UNKNOWN";
}

function httpStatus(error: StructuredProviderError): number | null {
  const status = error.$metadata?.httpStatusCode;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function hasRetryableThrottle(error: StructuredProviderError): boolean {
  const retryable = error.$retryable;
  return (
    (typeof retryable === "object" && retryable !== null && retryable.throttling === true) ||
    retryable === true
  );
}

function result(
  category: EmailProviderErrorCategory,
  retryable: boolean,
  acceptanceUnknown: boolean,
  normalizedCode: string,
  sanitizedMessage: string,
): ProviderErrorClassification {
  return {
    category,
    retryable,
    acceptanceUnknown,
    normalizedCode,
    sanitizedMessage,
  };
}

export function classifyProviderError(
  error: unknown,
  params: { requestDispatched: boolean },
): ProviderErrorClassification {
  const structured = asStructured(error);
  const name = stableName(structured);
  const status = httpStatus(structured);
  const code = name.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").slice(0, 80);

  if (NETWORK_ERROR_NAMES.has(name)) {
    if (params.requestDispatched) {
      return result(
        "ACCEPTANCE_UNKNOWN",
        false,
        true,
        "PROVIDER_ACCEPTANCE_UNKNOWN",
        "Provider request outcome is unknown after dispatch.",
      );
    }
    return result(
      "RETRYABLE_NETWORK",
      true,
      false,
      "PROVIDER_RETRYABLE_NETWORK",
      "Provider request failed due to a transient network error.",
    );
  }

  if (hasRetryableThrottle(structured) || status === 429) {
    return result(
      "RETRYABLE_THROTTLE",
      true,
      false,
      "PROVIDER_RETRYABLE_THROTTLE",
      "Provider throttled the email request.",
    );
  }

  if (status !== null && status >= 500) {
    return result(
      params.requestDispatched ? "ACCEPTANCE_UNKNOWN" : "RETRYABLE_SERVER_ERROR",
      !params.requestDispatched,
      params.requestDispatched,
      params.requestDispatched
        ? "PROVIDER_ACCEPTANCE_UNKNOWN"
        : "PROVIDER_RETRYABLE_SERVER_ERROR",
      params.requestDispatched
        ? "Provider server error occurred after request dispatch; acceptance is unknown."
        : "Provider returned a transient server error.",
    );
  }

  if (ACCESS_DENIED_NAMES.has(name) || status === 401 || status === 403) {
    return result(
      "ACCESS_DENIED",
      false,
      false,
      "PROVIDER_ACCESS_DENIED",
      "Provider denied email sending authorization.",
    );
  }

  if (CONFIGURATION_NAMES.has(name)) {
    return result(
      "CONFIGURATION_ERROR",
      false,
      false,
      "PROVIDER_CONFIGURATION_ERROR",
      "Provider email configuration is invalid.",
    );
  }

  if (VALIDATION_NAMES.has(name) || status === 400) {
    return result(
      "VALIDATION_ERROR",
      false,
      false,
      "PROVIDER_VALIDATION_ERROR",
      "Provider rejected the email request as invalid.",
    );
  }

  if (INVALID_SENDER_NAMES.has(name)) {
    return result(
      "INVALID_SENDER",
      false,
      false,
      "PROVIDER_INVALID_SENDER",
      "Provider rejected the configured sender.",
    );
  }

  if (INVALID_RECIPIENT_NAMES.has(name)) {
    return result(
      "INVALID_RECIPIENT",
      false,
      false,
      "PROVIDER_INVALID_RECIPIENT",
      "Provider rejected the recipient address.",
    );
  }

  if (status !== null && status >= 400 && status < 500) {
    return result(
      "PROVIDER_FINAL_FAILURE",
      false,
      false,
      `PROVIDER_FINAL_${status}`,
      "Provider rejected the email request.",
    );
  }

  return result(
    "UNKNOWN_PROVIDER_FAILURE",
    false,
    false,
    `PROVIDER_UNKNOWN_${code}`,
    "Provider email request failed.",
  );
}
