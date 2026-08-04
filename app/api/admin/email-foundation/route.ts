import { NextResponse } from "next/server";

import { apiRequireActiveAdminUser } from "@/lib/auth/api-guards";
import {
  enqueueAdminEmailTest,
  getAdminEmailTestPreview,
} from "@/lib/email/admin-test";
import type { EmailLocale } from "@/lib/email/types";

export const runtime = "nodejs";

function parseLocale(value: unknown): EmailLocale {
  return value === "ru" ? "ru" : "en";
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
    const body = (await request.json().catch(() => ({}))) as { locale?: unknown };
    const result = await enqueueAdminEmailTest(user, parseLocale(body.locale));
    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      status: result.status,
      created: result.created,
      suppressed: result.suppressed,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to enqueue email foundation test.",
      },
      { status: 400 },
    );
  }
}
