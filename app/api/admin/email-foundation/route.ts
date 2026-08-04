import { NextResponse } from "next/server";

import { apiRequireActiveAdminUser } from "@/lib/auth/api-guards";
import {
  enqueueAdminEmailTest,
  getAdminEmailTestPreview,
} from "@/lib/email/admin-test";
import { logEmailEvent } from "@/lib/email/observability";
import { parseEmailLocaleStrict, type EmailLocale } from "@/lib/email/types";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const rateLimitBuckets = new Map<string, number[]>();

function parseLocale(value: unknown): EmailLocale {
  const locale = parseEmailLocaleStrict(value);
  if (!locale) {
    throw new EmailFoundationApiError(
      "INVALID_LOCALE",
      "Locale must be either ru or en.",
      400,
    );
  }
  return locale;
}

class EmailFoundationApiError extends Error {
  constructor(
    readonly code: string,
    readonly safeMessage: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestOrigin = new URL(request.url).origin;
  if (origin !== requestOrigin) {
    throw new EmailFoundationApiError(
      "INVALID_ORIGIN",
      "Request origin is not allowed.",
      403,
    );
  }
}

function assertRateLimit(userId: string) {
  const now = Date.now();
  const recent = (rateLimitBuckets.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitBuckets.set(userId, recent);
    throw new EmailFoundationApiError(
      "RATE_LIMITED",
      "Too many email foundation test requests.",
      429,
    );
  }
  recent.push(now);
  rateLimitBuckets.set(userId, recent);
}

function errorResponse(error: unknown) {
  if (error instanceof EmailFoundationApiError) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.safeMessage },
      { status: error.status },
    );
  }

  logEmailEvent("error", "admin_email_foundation_failed", {
    errorCode: "ADMIN_EMAIL_FOUNDATION_FAILED",
  });
  return NextResponse.json(
    {
      ok: false,
      code: "ADMIN_EMAIL_FOUNDATION_FAILED",
      error: "Unable to enqueue email foundation test.",
    },
    { status: 500 },
  );
}

export async function GET() {
  const { user, response } = await apiRequireActiveAdminUser();
  if (response) return response;

  return NextResponse.json(getAdminEmailTestPreview(user));
}

export async function POST(request: Request) {
  const { user, response } = await apiRequireActiveAdminUser();
  if (response) return response;

  try {
    assertSameOrigin(request);
    assertRateLimit(user.id);
    const body = (await request.json().catch(() => ({}))) as { locale?: unknown };
    const result = await enqueueAdminEmailTest(user, parseLocale(body.locale));
    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      status: result.status,
      created: result.created,
      duplicate: result.duplicate,
      suppressed: result.suppressed,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
