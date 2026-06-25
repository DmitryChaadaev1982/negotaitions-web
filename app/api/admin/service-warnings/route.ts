import { NextResponse } from "next/server";

import { hasRecentCriticalServiceErrors } from "@/lib/services/external-service-events";
import { apiRequireAdminUser } from "@/lib/auth/api-guards";

export const runtime = "nodejs";

export async function GET() {
  const { response: authError } = await apiRequireAdminUser();
  if (authError) return authError;

  try {
    const hasRecentServiceErrors = await hasRecentCriticalServiceErrors(24);
    return NextResponse.json({ hasRecentServiceErrors });
  } catch {
    return NextResponse.json({ hasRecentServiceErrors: false });
  }
}
