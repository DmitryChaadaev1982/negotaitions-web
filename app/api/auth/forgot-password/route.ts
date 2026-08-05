import { NextResponse, type NextRequest } from "next/server";

import { requestPasswordReset } from "@/lib/auth/account-security";
import { getTrustedClientIdentity } from "@/lib/auth/client-ip";
import { normalizeEmail } from "@/lib/auth";
import {
  getForgotPasswordTimingFloorMs,
  withResponseTimingFloor,
} from "@/lib/auth/response-timing-floor";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { normalizeEmailAddress } from "@/lib/email/address";

const GENERIC_RESPONSE = {
  ok: true,
  messageKey: "auth.passwordResetRequestAccepted",
} as const;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const startedAtMs = Date.now();
  const floorMs = getForgotPasswordTimingFloorMs();

  return withResponseTimingFloor({
    floorMs,
    startedAtMs,
    operation: async () => {
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

      const identity = getTrustedClientIdentity(request.headers);
      try {
        await requestPasswordReset({
          normalizedEmail: email,
          clientIpFingerprint: identity.fingerprint,
        });
      } catch {
        // Public recovery intentionally does not expose account, suppression,
        // rate-limit, or transient infrastructure state.
      }
      return NextResponse.json(GENERIC_RESPONSE, { headers: NO_STORE_HEADERS });
    },
  });
}
