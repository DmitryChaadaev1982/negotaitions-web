import { NextResponse } from "next/server";

import { validateRejoinContext } from "@/lib/rejoin/validate";
import { rejoinValidateSchema } from "@/lib/validations/rejoin";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ valid: false, reason: "invalidJson" }, { status: 400 });
  }

  const parsed = rejoinValidateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ valid: false, reason: "invalidInput" }, { status: 400 });
  }

  const result = await validateRejoinContext(parsed.data);

  if (!result.valid) {
    return NextResponse.json(result, { status: 200 });
  }

  return NextResponse.json(result);
}
