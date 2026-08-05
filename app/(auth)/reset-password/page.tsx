import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata: Metadata = {
  title: "Reset password",
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

/**
 * Reset tokens must arrive only via URL fragment (#token=...), never as a
 * query parameter. Query-token links are rejected because they have already
 * entered the request URI / access logs / browser history.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  // Reject the key itself, including empty and duplicate query values. Query
  // tokens have already entered the HTTP request URI.
  const hasQueryToken = Object.prototype.hasOwnProperty.call(params, "token");

  return (
    <ResetPasswordForm
      rejectQueryToken={hasQueryToken}
    />
  );
}
