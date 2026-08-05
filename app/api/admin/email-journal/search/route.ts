import { NextResponse } from "next/server";

import { apiRequireActiveAdminUser } from "@/lib/auth/api-guards";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import {
  EmailJournalInputError,
  listEmailJournal,
  parseEmailJournalRecipientSearchBody,
} from "@/lib/email/admin-journal";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Private recipient search — full addresses stay out of GET URLs / history.
 */
export async function POST(request: Request) {
  const { user, response } = await apiRequireActiveAdminUser();
  if (response) {
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });
  }
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403, headers: NO_STORE });
  }

  try {
    const body = await request.json();
    const query = parseEmailJournalRecipientSearchBody(body);
    const result = await listEmailJournal(query);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EmailJournalInputError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { error: "Unable to search email journal." },
      { status: 500, headers: NO_STORE },
    );
  }
}
