"use server";

import { redirect } from "next/navigation";

import { resetPasswordWithToken } from "@/lib/auth/account-security";

export type ResetPasswordActionResult = {
  error?: string;
};

export async function resetPassword(
  _previous: ResetPasswordActionResult,
  formData: FormData,
): Promise<ResetPasswordActionResult> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmPassword") ?? "");

  if (!password || password.length < 8) {
    return { error: "auth.passwordTooShort" };
  }
  if (password !== confirmation) {
    return { error: "auth.passwordMismatch" };
  }

  try {
    const succeeded = await resetPasswordWithToken({
      rawToken: token,
      newPassword: password,
    });
    if (!succeeded) return { error: "auth.passwordResetInvalid" };
  } catch {
    return { error: "auth.passwordResetInvalid" };
  }

  redirect("/login?passwordReset=success");
}
