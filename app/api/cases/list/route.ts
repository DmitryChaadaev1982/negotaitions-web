import { NextResponse } from "next/server";

import { apiRequireActiveUser } from "@/lib/auth/api-guards";
import { getCasesForUser } from "@/lib/case-overview";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response: authError } = await apiRequireActiveUser();
  if (authError) return authError;

  const data = await getCasesForUser(user);
  return NextResponse.json(data);
}
