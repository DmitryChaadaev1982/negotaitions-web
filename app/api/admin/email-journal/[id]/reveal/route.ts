import { NextResponse } from "next/server";

import { apiRequireActiveAdminUser } from "@/lib/auth/api-guards";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import {
  EmailJournalInputError,
  revealEmailJournalContent,
} from "@/lib/email/admin-journal";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { user, response } = await apiRequireActiveAdminUser();
  if (response) {
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json(
        { error: "Request origin is not allowed." },
        { status: 403, headers: NO_STORE },
      );
    }

    const { id } = await context.params;
    const requestId =
      request.headers.get("x-request-id")?.trim().slice(0, 128) || null;
    const revealed = await revealEmailJournalContent({
      messageId: id,
      adminUserId: user.id,
      requestId,
    });
    return NextResponse.json(revealed, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EmailJournalInputError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { error: "Unable to reveal email content." },
      { status: 500, headers: NO_STORE },
    );
  }
}
