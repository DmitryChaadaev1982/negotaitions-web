const BASIC_EMAIL_REGEX =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function isSupportedEmailAddress(value: string): boolean {
  if (value.length > 254 || !BASIC_EMAIL_REGEX.test(value)) return false;
  const separator = value.lastIndexOf("@");
  return separator > 0 && separator <= 64;
}

export function normalizeEmailAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  // Internationalized addresses are not supported by the current provider
  // contract. Reject them rather than relying on implicit Unicode/IDNA rules.
  if (!isSupportedEmailAddress(normalized)) {
    throw new Error("Invalid email address.");
  }
  return normalized;
}

export function validateEmailAddress(value: string, key = "email"): string {
  const trimmed = value.trim();
  if (!isSupportedEmailAddress(trimmed)) {
    throw new Error(`Invalid ${key}.`);
  }
  if (/[\r\n]/.test(trimmed)) {
    throw new Error(`Invalid ${key}: header injection characters are not allowed.`);
  }
  return trimmed;
}

export function redactEmail(value: string | null | undefined): string {
  if (!value) return "unknown";
  const [local, domain] = value.split("@");
  if (!local || !domain) return "invalid";
  const prefix = local.slice(0, 2);
  return `${prefix}${"*".repeat(Math.max(2, local.length - 2))}@${domain}`;
}
