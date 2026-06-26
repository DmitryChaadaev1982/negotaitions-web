"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/crypto";
import { requireActiveUser } from "@/lib/auth";

type ActionResult = {
  success?: boolean;
  error?: string;
};

/** Update the authenticated user's display name. */
export async function updateDisplayName(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireActiveUser("/login");

  const rawName = String(formData.get("name") ?? "").trim();

  if (!rawName) {
    return { error: "validation.nameRequired" };
  }
  if (rawName.length > 100) {
    return { error: "validation.nameRequired" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { name: rawName },
  });

  revalidatePath("/account/settings");
  return { success: true };
}

/** Change the authenticated user's password. */
export async function updatePassword(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireActiveUser("/login");

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: "auth.passwordRequired" };
  }

  if (newPassword.length < 8) {
    return { error: "auth.passwordTooShort" };
  }

  if (newPassword !== confirmPassword) {
    return { error: "auth.passwordMismatch" };
  }

  // Fetch current password hash — never return it to the client.
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  if (!dbUser) {
    return { error: "auth.loginFailed" };
  }

  const valid = await verifyPassword(currentPassword, dbUser.passwordHash);
  if (!valid) {
    return { error: "auth.invalidCurrentPassword" };
  }

  const newHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  // Current session remains active after password change (MVP; TODO: invalidate other sessions later).

  return { success: true };
}
