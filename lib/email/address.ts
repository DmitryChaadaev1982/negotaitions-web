const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!BASIC_EMAIL_REGEX.test(normalized)) {
    throw new Error("Invalid email address.");
  }
  return normalized;
}

export function validateEmailAddress(value: string, key = "email"): string {
  const trimmed = value.trim();
  if (!BASIC_EMAIL_REGEX.test(trimmed)) {
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
