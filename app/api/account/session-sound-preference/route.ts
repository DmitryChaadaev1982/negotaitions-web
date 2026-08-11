import { NextResponse } from "next/server";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import {
  getSessionSoundPreferenceForUser,
  sessionSoundPreferenceUpdateSchema,
  updateSessionSoundPreferenceForUser,
} from "@/lib/session-sound-preference";

export const runtime = "nodejs";

function isAccountAllowed(user: { status: string; globalRole: string; email: string }) {
  return isAdmin(user) || user.status === "ACTIVE";
}

export async function GET() {
  const user = await getOptionalCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "loginRequired" }, { status: 401 });
  }
  if (!isAccountAllowed(user)) {
    return NextResponse.json({ error: "accountStatusRestricted" }, { status: 403 });
  }

  const preference = await getSessionSoundPreferenceForUser(user.id);
  return NextResponse.json(preference);
}

export async function PATCH(request: Request) {
  const user = await getOptionalCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "loginRequired" }, { status: 401 });
  }
  if (!isAccountAllowed(user)) {
    return NextResponse.json({ error: "accountStatusRestricted" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  const parsed = sessionSoundPreferenceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalidPayload" }, { status: 400 });
  }

  const updated = await updateSessionSoundPreferenceForUser(user.id, parsed.data);
  return NextResponse.json(updated);
}
