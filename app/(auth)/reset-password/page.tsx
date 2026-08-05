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
  const hasQueryToken =
    typeof params.token === "string"
      ? params.token.length > 0
      : Array.isArray(params.token) && params.token.length > 0;

  return (
    <ResetPasswordForm
      rejectQueryToken={hasQueryToken}
    />
  );
}
