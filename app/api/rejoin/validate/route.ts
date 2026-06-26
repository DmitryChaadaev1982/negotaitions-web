import { NextResponse } from "next/server";

import { getOptionalCurrentUser } from "@/lib/auth";
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

  const currentUser = await getOptionalCurrentUser();

  // Phase 6.4.2: guest runtime access is closed. Any token supplied by an
  // unauthenticated client (e.g. a stale localStorage recovery entry) must NOT
  // be accepted as runtime auth and must NOT be echoed back. Unauthenticated
  // callers always get a safe login-required fallback.
  if (!currentUser) {
    return NextResponse.json({ valid: false, reason: "loginRequired" });
  }

  const result = await validateRejoinContext(parsed.data);

  if (!result.valid) {
    return NextResponse.json(result, { status: 200 });
  }

  return NextResponse.json(result);
}
