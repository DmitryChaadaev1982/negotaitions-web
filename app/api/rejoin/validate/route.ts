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
  if (
    !currentUser &&
    (parsed.data.type === "SESSION_JOIN" || parsed.data.type === "SESSION_ROOM")
  ) {
    const joinToken = parsed.data.joinToken?.trim();
    if (!joinToken) {
      return NextResponse.json({ valid: false, reason: "missingJoinToken" });
    }

    const returnUrl =
      parsed.data.type === "SESSION_ROOM" && parsed.data.sessionId
        ? `/room/${parsed.data.sessionId}?joinToken=${joinToken}`
        : `/join/${joinToken}`;

    return NextResponse.json({
      valid: true,
      primaryAction: parsed.data.type === "SESSION_ROOM" ? "room" : "materials",
      targetUrl: `/login?returnUrl=${encodeURIComponent(returnUrl)}`,
    });
  }

  const result = await validateRejoinContext(parsed.data);

  if (!result.valid) {
    return NextResponse.json(result, { status: 200 });
  }

  return NextResponse.json(result);
}
