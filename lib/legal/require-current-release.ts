import { redirect } from "next/navigation";

import { buildLegalUpdateRedirectPath } from "@/lib/legal/legal-update-return-url";
import { getUserLegalReleaseStatus } from "@/lib/legal/status";

/**
 * Navigation/fresh-load gate for an authenticated user. No-ops when there is
 * no user, when the current release does not require existing-user action, or
 * when required records are already present. Never intended for provider
 * callbacks, webhooks, or anonymous public legal routes.
 */
export async function requireCurrentLegalRelease(
  user: { id: string } | null | undefined,
  options?: { returnUrl?: string | null },
): Promise<void> {
  if (!user) return;
  const status = await getUserLegalReleaseStatus(user.id);
  if (!status.actionRequired) return;
  redirect(buildLegalUpdateRedirectPath(options?.returnUrl));
}
