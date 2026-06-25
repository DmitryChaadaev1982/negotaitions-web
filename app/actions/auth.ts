"use server";

import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import crypto from "crypto";

import { prisma } from "@/lib/prisma";
import {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  createUserSession,
  destroyUserSession,
  getOptionalCurrentUser,
} from "@/lib/auth";
import { isAdmin, parseAdminEmails } from "@/lib/auth/admin";
import { CONSENT_TYPES } from "@/lib/consent/cookie-consent";
import { isLocale, LOCALE_COOKIE_NAME } from "@/lib/i18n/config";

type ActionResult = {
  errors?: Record<string, string[]>;
};

export async function registerUser(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const rawName = String(formData.get("name") ?? "").trim();
  const rawEmail = String(formData.get("email") ?? "").trim();
  const rawPassword = String(formData.get("password") ?? "");
  const rawConfirm = String(formData.get("confirmPassword") ?? "");
  const rawLocale = String(formData.get("preferredLocale") ?? "ru").trim();
  const preferredLocale = isLocale(rawLocale) ? rawLocale : "ru";

  const consentTermsPrivacy = formData.get("consentTermsPrivacy") === "1";
  const consentMvpDataLimitation = formData.get("consentMvpDataLimitation") === "1";
  const consentExternalInfrastructure = formData.get("consentExternalInfrastructure") === "1";

  const errors: Record<string, string[]> = {};

  if (!rawName) errors.name = ["auth.nameRequired"];
  if (!rawEmail) errors.email = ["auth.emailRequired"];
  if (!rawPassword) errors.password = ["auth.passwordRequired"];
  if (!rawConfirm) errors.confirmPassword = ["auth.confirmPasswordRequired"];

  if (rawPassword && rawPassword.length < 8)
    errors.password = ["auth.passwordTooShort"];
  if (rawPassword && rawConfirm && rawPassword !== rawConfirm)
    errors.confirmPassword = ["auth.passwordMismatch"];

  if (!consentTermsPrivacy || !consentMvpDataLimitation || !consentExternalInfrastructure) {
    errors.consents = ["legal.consentRequired"];
  }

  if (Object.keys(errors).length > 0) return { errors };

  const email = normalizeEmail(rawEmail);
  const passwordHash = await hashPassword(rawPassword);

  const adminEmails = parseAdminEmails();
  const isAdminEmail = adminEmails.includes(email);

  const globalRole = isAdminEmail ? "ADMIN" : "USER";
  const status = isAdminEmail ? "ACTIVE" : "PENDING_APPROVAL";
  const now = new Date();

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return { errors: { email: ["auth.emailTaken"] } };
    }

    const headersList = await headers();
    const userAgent = headersList.get("user-agent") ?? undefined;
    const rawIp =
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      headersList.get("x-real-ip") ??
      "";
    const ipHash = rawIp
      ? crypto.createHash("sha256").update(rawIp).digest("hex").slice(0, 16)
      : undefined;

    // User creation and consent records must be atomic: if consent write fails,
    // the user record must not be left without legal consent.
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: rawName,
          passwordHash,
          globalRole,
          status,
          preferredLocale,
          lastLoginAt: now,
          ...(isAdminEmail ? { approvedAt: now } : {}),
        },
      });

      await tx.userConsent.createMany({
        data: [
          {
            userId: created.id,
            consentType: CONSENT_TYPES.TERMS_PRIVACY_V1,
            version: "1",
            acceptedAt: now,
            ipHash: ipHash ?? null,
            userAgent: userAgent ?? null,
          },
          {
            userId: created.id,
            consentType: CONSENT_TYPES.MVP_DATA_LIMITATION_V1,
            version: "1",
            acceptedAt: now,
            ipHash: ipHash ?? null,
            userAgent: userAgent ?? null,
          },
          {
            userId: created.id,
            consentType: CONSENT_TYPES.EXTERNAL_INFRASTRUCTURE_V1,
            version: "1",
            acceptedAt: now,
            ipHash: ipHash ?? null,
            userAgent: userAgent ?? null,
          },
        ],
      });

      return created;
    });

    await createUserSession(user.id, { userAgent });

    // Persist chosen locale in cookie so pages render in the user's language immediately.
    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE_NAME, preferredLocale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: false,
    });
  } catch {
    return { errors: { form: ["auth.registerFailed"] } };
  }

  if (isAdminEmail) {
    redirect("/dashboard");
  } else {
    redirect("/pending-approval");
  }
}

export async function loginUser(
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const rawEmail = String(formData.get("email") ?? "").trim();
  const rawPassword = String(formData.get("password") ?? "");
  const returnUrl = String(formData.get("returnUrl") ?? "").trim();

  if (!rawEmail || !rawPassword) {
    return { errors: { form: ["auth.invalidCredentials"] } };
  }

  const email = normalizeEmail(rawEmail);

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await verifyPassword(rawPassword, user.passwordHash))) {
    return { errors: { form: ["auth.invalidCredentials"] } };
  }

  // Admin bootstrap: if email is in ADMIN_EMAILS, upgrade on login
  const adminEmails = parseAdminEmails();
  const isAdminEmail = adminEmails.includes(email);

  if (isAdminEmail && (user.globalRole !== "ADMIN" || user.status !== "ACTIVE")) {
    const now = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        globalRole: "ADMIN",
        status: "ACTIVE",
        approvedAt: user.approvedAt ?? now,
        lastLoginAt: now,
      },
    });
    user.globalRole = "ADMIN";
    user.status = "ACTIVE";
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
  }

  const headersList = await headers();
  await createUserSession(user.id, {
    userAgent: headersList.get("user-agent") ?? undefined,
  });

  // Sync locale cookie to user's saved preferredLocale so pages render immediately in their language.
  const userLocale = (user as Record<string, unknown>).preferredLocale;
  if (typeof userLocale === "string" && isLocale(userLocale)) {
    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE_NAME, userLocale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: false,
    });
  }

  if (isAdmin(user)) {
    redirect(isSafeReturnUrl(returnUrl) ? returnUrl : "/dashboard");
  }

  if (user.status === "PENDING_APPROVAL") {
    redirect("/pending-approval");
  }

  if (user.status === "REJECTED") {
    redirect("/account/rejected");
  }

  if (user.status === "BLOCKED") {
    redirect("/account/blocked");
  }

  redirect(isSafeReturnUrl(returnUrl) ? returnUrl : "/dashboard");
}

export async function logoutUser(): Promise<void> {
  await destroyUserSession();
  redirect("/login");
}

function isSafeReturnUrl(url: string): boolean {
  if (!url) return false;
  // Only allow relative paths starting with /
  return url.startsWith("/") && !url.startsWith("//");
}

export async function getCurrentUserForHeader() {
  return getOptionalCurrentUser();
}

/**
 * Update the logged-in user's preferredLocale.
 * Called when the user switches language while authenticated.
 * Also updates the locale cookie for immediate effect.
 */
export async function updateUserPreferredLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;

  const user = await getOptionalCurrentUser();
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { preferredLocale: locale },
  });

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });
}
