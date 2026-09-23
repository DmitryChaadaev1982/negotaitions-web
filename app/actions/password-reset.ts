"use server";

import { redirect } from "next/navigation";

import { resetPasswordWithToken } from "@/lib/auth/account-security";
import { PasswordReusedError } from "@/lib/auth/password-history";
import {
  PasswordPolicyError,
  passwordPolicyFailureKey,
  validateNewPassword,
} from "@/lib/auth/password-policy";
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
  if (!policy.ok) {
    return {
      error: passwordPolicyFailureKey(policy.codes) ?? "auth.passwordResetInvalid",
    };
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
    if (error instanceof PasswordReusedError) {
      return { error: "auth.passwordReused" };
    }
    if (error instanceof PasswordPolicyError) {
      return {
        error:
          passwordPolicyFailureKey(error.codes) ?? "auth.passwordResetInvalid",
      };
    }
    // A rolled-back reset transaction leaves the token unconsumed; invalid,
    // expired, consumed, and revoked tokens return false instead of throwing.
    return { error: passwordResetErrorKey(error) };
  }

  redirect("/login?passwordReset=success");
}
