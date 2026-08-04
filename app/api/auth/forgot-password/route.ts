import { NextResponse, type NextRequest } from "next/server";

import { requestPasswordReset } from "@/lib/auth/account-security";
import { normalizeEmail } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { normalizeEmailAddress } from "@/lib/email/address";

const GENERIC_RESPONSE = {
  ok: true,
  messageKey: "auth.passwordResetRequestAccepted",
} as const;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(GENERIC_RESPONSE, {
      status: 403,
      headers: NO_STORE_HEADERS,
    });
  }

  let email: string;
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email !== "string") throw new Error("Invalid email.");
    email = normalizeEmailAddress(normalizeEmail(body.email));
  } catch {
    return NextResponse.json(
      { ok: false, messageKey: "auth.invalidEmail" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const rawIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip");
  try {
    await requestPasswordReset({ normalizedEmail: email, rawIp });
  } catch {
    // Public recovery intentionally does not expose account, suppression,
    // rate-limit, or transient infrastructure state.
  }
  return NextResponse.json(GENERIC_RESPONSE, { headers: NO_STORE_HEADERS });
}
