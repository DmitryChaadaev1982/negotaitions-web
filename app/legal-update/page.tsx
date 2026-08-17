import { redirect } from "next/navigation";

import { LegalUpdateView } from "@/components/legal-update-view";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { LEGAL_UPDATE_PATH } from "@/lib/legal/release";
import {
  isCredentialBearingReturnUrl,
  sanitizeLegalUpdateReturnUrl,
} from "@/lib/legal/legal-update-return-url";
import { getUserLegalReleaseStatus } from "@/lib/legal/status";
import { privateIndexingMetadata } from "@/lib/seo/indexing";

export const metadata = privateIndexingMetadata;
export const dynamic = "force-dynamic";

export default async function LegalUpdatePage({
  searchParams,
}: {
  searchParams: Promise<{ returnUrl?: string | string[] }>;
}) {
  const user = await getOptionalCurrentUser();
  const params = await searchParams;
  const rawReturnUrl = Array.isArray(params.returnUrl)
    ? params.returnUrl[0]
    : params.returnUrl;
  const safeReturnUrl = sanitizeLegalUpdateReturnUrl(rawReturnUrl);
  if (
    typeof rawReturnUrl === "string" &&
    isCredentialBearingReturnUrl(rawReturnUrl.trim())
  ) {
    redirect(LEGAL_UPDATE_PATH);
  }

  if (!user) {
    redirect(
      `/login?returnUrl=${encodeURIComponent(LEGAL_UPDATE_PATH)}`,
    );
  }

  if (!isAdmin(user)) {
    if (user.status === "PENDING_APPROVAL") {
      redirect("/pending-approval");
    }
    if (user.status === "REJECTED") {
      redirect("/account/rejected");
    }
    if (user.status === "BLOCKED") {
      redirect("/account/blocked");
    }
  }

  const status = await getUserLegalReleaseStatus(user.id);
  if (!status.actionRequired) {
    redirect(safeReturnUrl ?? "/dashboard");
  }

  return <LegalUpdateView />;
}
