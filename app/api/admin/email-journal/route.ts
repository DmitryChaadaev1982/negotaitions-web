import { NextResponse } from "next/server";

import { apiRequireActiveAdminUser } from "@/lib/auth/api-guards";
import {
  EmailJournalInputError,
  listEmailJournal,
  parseEmailJournalListQuery,
} from "@/lib/email/admin-journal";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const { response } = await apiRequireActiveAdminUser();
  if (response) {
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  try {
    const query = parseEmailJournalListQuery(new URL(request.url).searchParams);
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
      { error: "Unable to load email journal." },
      { status: 500, headers: NO_STORE },
    );
  }
}
