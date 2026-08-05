"use server";

import { redirect } from "next/navigation";

import { resetPasswordWithToken } from "@/lib/auth/account-security";
import { passwordResetErrorKey } from "@/lib/auth/account-security-error-messages";
import { consumePasswordResetFinalizeAttempt } from "@/lib/auth/password-reset-rate-limit";
import {
  hashPasswordResetToken,
  isPasswordResetTokenShape,
} from "@/lib/auth/password-reset-token";

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
  if (!isPasswordResetTokenShape(token)) {
    return { error: "auth.passwordResetInvalid" };
  }

  // Cheap consume limiter before bcrypt / DB claim work (M-02).
  const tokenFingerprint = hashPasswordResetToken(token).slice(0, 32);
  if (!consumePasswordResetFinalizeAttempt(tokenFingerprint)) {
    return { error: "auth.passwordResetInvalid" };
  }

  try {
    const succeeded = await resetPasswordWithToken({
      rawToken: token,
      newPassword: password,
    });
    if (!succeeded) return { error: "auth.passwordResetInvalid" };
  } catch (error) {
    // A rolled-back reset transaction leaves the token unconsumed; invalid,
    // expired, consumed, and revoked tokens return false instead of throwing.
    return { error: passwordResetErrorKey(error) };
  }

  redirect("/login?passwordReset=success");
}
