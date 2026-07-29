import { NextResponse } from "next/server";

import { apiRequireActiveUser } from "@/lib/auth/api-guards";
import { getSessionsForUser } from "@/lib/session-overview-stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response: authError } = await apiRequireActiveUser();
  if (authError) return authError;

  const sessions = await getSessionsForUser(user);
  return NextResponse.json({ sessions });
}
