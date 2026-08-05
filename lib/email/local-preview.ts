import type { EmailMessageType } from "@/app/generated/prisma/client";
import type { EmailConfig } from "@/lib/email/config";

export const LOCAL_EMAIL_PREVIEW_ORIGIN = "https://local.negotaitions.ru";
export const LOCAL_EMAIL_PREVIEW_MAX_LIMIT = 20;

export const LOCAL_EMAIL_PREVIEW_TYPES = [
  "PASSWORD_RESET",
  "ACCOUNT_RECOVERY_DENIED",
  "PASSWORD_CHANGED",
  "ADMIN_PENDING_APPROVAL",
] as const satisfies readonly EmailMessageType[];

export type LocalEmailPreviewType = (typeof LOCAL_EMAIL_PREVIEW_TYPES)[number];

const LOCAL_EMAIL_PREVIEW_TYPE_SET = new Set<string>(LOCAL_EMAIL_PREVIEW_TYPES);
const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class LocalEmailPreviewInputError extends Error {}

export function isLocalEmailPreviewAvailable(input: {
  nodeEnv: string | undefined;
  config: Pick<
    EmailConfig,
    "provider" | "localPreviewEnabled" | "canonicalBaseUrl"
  >;
}): boolean {
  return (
    input.nodeEnv !== "production" &&
    input.config.provider === "fake" &&
    input.config.localPreviewEnabled === true &&
    input.config.canonicalBaseUrl === LOCAL_EMAIL_PREVIEW_ORIGIN
  );
}

export function parseLocalEmailPreviewType(
  value: string | null | undefined,
): LocalEmailPreviewType | undefined {
  if (!value) return undefined;
  if (!LOCAL_EMAIL_PREVIEW_TYPE_SET.has(value)) {
    throw new LocalEmailPreviewInputError("Invalid email preview type.");
  }
  return value as LocalEmailPreviewType;
}

export function parseLocalEmailPreviewLimit(
  value: string | null | undefined,
): number {
  if (!value) return LOCAL_EMAIL_PREVIEW_MAX_LIMIT;
  if (!/^\d+$/.test(value)) {
    throw new LocalEmailPreviewInputError("Invalid email preview limit.");
  }
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > LOCAL_EMAIL_PREVIEW_MAX_LIMIT
  ) {
    throw new LocalEmailPreviewInputError("Invalid email preview limit.");
  }
  return parsed;
}

export function parseLocalEmailPreviewListQuery(searchParams: URLSearchParams): {
  limit: number;
  type?: LocalEmailPreviewType;
} {
  const allowedKeys = new Set(["limit", "type"]);
  for (const key of searchParams.keys()) {
    if (!allowedKeys.has(key)) {
      throw new LocalEmailPreviewInputError("Unsupported email preview query.");
    }
  }
  if (searchParams.getAll("limit").length > 1 || searchParams.getAll("type").length > 1) {
    throw new LocalEmailPreviewInputError("Duplicate email preview query.");
  }
  return {
    limit: parseLocalEmailPreviewLimit(searchParams.get("limit")),
    type: parseLocalEmailPreviewType(searchParams.get("type")),
  };
}

export function parseLocalEmailPreviewId(value: unknown): string {
  if (typeof value !== "string" || !PREVIEW_ID_PATTERN.test(value)) {
    throw new LocalEmailPreviewInputError("Invalid email preview identifier.");
  }
  return value;
}

export function maskEmailRecipient(value: string | null): string {
  if (!value) return "(unavailable)";
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return "***";

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const suffix = dot > 0 ? domain.slice(dot) : "";
  // One-character local/domain parts must not leak the sole character alone.
  const localPrefix = local.length <= 1 ? "*" : (local[0] ?? "");
  const domainPrefix = domainName.length <= 1 ? "*" : (domainName[0] ?? "");

  return `${localPrefix}***@${domainPrefix}***${suffix}`;
}
