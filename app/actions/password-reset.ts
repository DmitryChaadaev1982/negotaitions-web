"use server";

import { redirect } from "next/navigation";

import { resetPasswordWithToken } from "@/lib/auth/account-security";
import { validateNewPassword } from "@/lib/auth/password-policy";
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

  const policy = validateNewPassword({
    password,
    confirmation,
  });
  if (!policy.ok && policy.codes.includes("too_short")) {
    return { error: "auth.passwordTooShort" };
  }
  if (!policy.ok && policy.codes.includes("mismatch")) {
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
