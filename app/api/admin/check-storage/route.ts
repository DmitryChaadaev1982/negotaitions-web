import { NextResponse } from "next/server";

import { getDemoFacilitator } from "@/lib/demo-user";
import { checkStorageHealth } from "@/lib/storage/s3";

export const runtime = "nodejs";

export async function POST() {
  await getDemoFacilitator();
  const result = await checkStorageHealth();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
