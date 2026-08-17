"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getOptionalCurrentUser } from "@/lib/auth";
import {
  getTrustedClientIdentity,
  shortClientIpFingerprint,
} from "@/lib/auth/client-ip";
import { consentFieldName } from "@/lib/consent/user-consent";
import { persistCurrentLegalReleaseAcceptance } from "@/lib/legal/accept-release";
import { getCurrentLegalRelease } from "@/lib/legal/release";
import { sanitizeLegalUpdateReturnUrl } from "@/lib/legal/legal-update-return-url";

type ActionResult = {
  errors?: Record<string, string[]>;
};

function safePostAcceptancePath(rawReturnUrl: string): string {
  return sanitizeLegalUpdateReturnUrl(rawReturnUrl) ?? "/dashboard";
}

export async function acceptCurrentLegalRelease(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getOptionalCurrentUser();
  const returnUrl = String(formData.get("returnUrl") ?? "").trim();
  const nextPath = safePostAcceptancePath(returnUrl);

  if (!user) {
    redirect(`/login?returnUrl=${encodeURIComponent("/legal-update")}`);
  }

  const release = getCurrentLegalRelease();
  const acceptedAllRequired = release.requiredConsentTypes.every(
    (consentType) => formData.get(consentFieldName(consentType)) === "1",
  );
  if (!acceptedAllRequired) {
    return { errors: { consents: ["legal.consentRequired"] } };
  }

  const headersList = await headers();
  const userAgent = headersList.get("user-agent") ?? undefined;
  const identity = getTrustedClientIdentity(headersList);
  const ipHash = shortClientIpFingerprint(identity.fingerprint);

  await persistCurrentLegalReleaseAcceptance({
    userId: user.id,
    ipHash,
    userAgent,
  });

  redirect(nextPath);
}
