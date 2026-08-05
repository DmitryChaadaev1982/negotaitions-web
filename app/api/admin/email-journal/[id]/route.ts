import { NextResponse } from "next/server";

import { apiRequireActiveAdminUser } from "@/lib/auth/api-guards";
import {
  EmailJournalInputError,
  getEmailJournalDetail,
} from "@/lib/email/admin-journal";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { response } = await apiRequireActiveAdminUser();
  if (response) {
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  try {
    const { id } = await context.params;
    const detail = await getEmailJournalDetail(id);
    if (!detail) {
      return NextResponse.json(
        { error: "Not found." },
        { status: 404, headers: NO_STORE },
      );
    }
    return NextResponse.json(detail, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof EmailJournalInputError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { error: "Unable to load email journal detail." },
      { status: 500, headers: NO_STORE },
    );
  }
}
