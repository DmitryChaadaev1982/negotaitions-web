import { NextResponse } from "next/server";

import { checkLiveKitHealth } from "@/lib/services/admin-health";
import { apiRequireAdminUser } from "@/lib/auth/api-guards";

export const runtime = "nodejs";

export async function POST() {
  const { response: authError } = await apiRequireAdminUser();
  if (authError) return authError;

  const result = await checkLiveKitHealth();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
