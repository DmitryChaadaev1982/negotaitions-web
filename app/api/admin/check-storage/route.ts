import { NextResponse } from "next/server";

import { checkStorageHealth } from "@/lib/storage/s3";
import { apiRequireAdminUser } from "@/lib/auth/api-guards";

export const runtime = "nodejs";

export async function POST() {
  const { response: authError } = await apiRequireAdminUser();
  if (authError) return authError;

  const result = await checkStorageHealth();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
