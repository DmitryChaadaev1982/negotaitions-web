import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isExternalServicesMockMode,
  setMockExternalServiceError,
} from "@/lib/test-mode";

export const runtime = "nodejs";

const mockExternalServiceSchema = z.object({
  error: z.string().trim().min(1).nullable(),
});

export async function POST(request: Request) {
  if (!isExternalServicesMockMode()) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = mockExternalServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  setMockExternalServiceError(parsed.data.error);

  return NextResponse.json({
    ok: true,
    error: parsed.data.error,
  });
}

