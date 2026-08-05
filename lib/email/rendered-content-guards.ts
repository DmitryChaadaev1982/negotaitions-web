import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Content guards applied before an `EmailMessage` row is written.
 *
 * Raw password-reset tokens are 32 random bytes rendered as 64 lowercase hex
 * characters. Nothing token-shaped may be persisted in a rendered body, a
 * subject, or JSON metadata: the raw token exists only inside the AES-256-GCM
 * sensitive payload and in worker memory during late render.
 *
 * Guard failures never echo the offending content.
 */

/**
 * Matches any run of at least 64 hex characters, so a longer hex blob that
 * embeds a token-shaped value is also rejected.
 */
const RESET_TOKEN_SHAPE = /[a-f0-9]{64}/i;

export function containsResetTokenShapedValue(
  value: string | null | undefined,
): boolean {
  return typeof value === "string" && RESET_TOKEN_SHAPE.test(value);
}

/**
 * Deferred sensitive messages persist only a token-free subject; bodies stay
 * null until worker late render. This guard is unconditional: it must not be
 * weakened by the presence of the token-free placeholder action URL, which the
 * rendered placeholder body always contains.
 */
export function assertDeferredSensitiveRenderIsTokenFree(rendered: {
  subject?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
}): void {
  if (
    containsResetTokenShapedValue(rendered.subject) ||
    containsResetTokenShapedValue(rendered.textBody) ||
    containsResetTokenShapedValue(rendered.htmlBody)
  ) {
    throw new Error(
      "Refusing to enqueue password-reset content with raw token material.",
    );
  }
}

export function sanitizeEmailMetadata(
  metadata: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined;
  const json = JSON.stringify(metadata);
  if (json.length > 4096) {
    throw new Error("Email metadata is too large.");
  }
  // Defense-in-depth: refuse metadata that looks like it embeds a raw reset token.
  if (/\b[a-f0-9]{64}\b/i.test(json) && /token/i.test(json)) {
    throw new Error("Email metadata must not contain reset token material.");
  }
  return JSON.parse(json) as Prisma.InputJsonValue;
}
