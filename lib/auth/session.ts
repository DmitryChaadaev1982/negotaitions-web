import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  runAfterUserRowLockedForSessionHook,
  runBeforeSessionCreateHook,
  StaleCredentialError,
} from "@/lib/auth/credential-concurrency";
import { lockUserRowForUpdate } from "@/lib/auth/user-row-lock";
import { prisma } from "@/lib/prisma";

import { isAdmin, parseAdminEmails } from "./admin";
import { generateSessionToken, hashSessionToken } from "./crypto";

const COOKIE_NAME = "auth_session";
const SESSION_DURATION_DAYS = 30;
const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  globalRole: string;
  status: string;
  preferredLocale: string;
};

/**
 * Persist a UserSession when the observed credential generation is still
 * current. Returns the raw session token (caller issues the cookie).
 *
 * When expectedCredentialGeneration is provided, the User row is locked with
 * SELECT ... FOR UPDATE, generation is inspected, and UserSession is inserted
 * while holding that lock.
 */
export async function createUserSessionToken(
  userId: string,
  meta?: {
    userAgent?: string;
    ipHash?: string;
    expectedCredentialGeneration?: number;
  },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );

  await runBeforeSessionCreateHook();

  if (typeof meta?.expectedCredentialGeneration === "number") {
    await prisma.$transaction(async (tx) => {
      const locked = await lockUserRowForUpdate(tx, userId);
      if (
        !locked ||
        locked.credentialGeneration !== meta.expectedCredentialGeneration
      ) {
        throw new StaleCredentialError();
      }

      // Deterministic test barrier while the User row lock is held.
      await runAfterUserRowLockedForSessionHook();

      await tx.userSession.create({
        data: {
          userId,
          sessionTokenHash: tokenHash,
          expiresAt,
          userAgent: meta?.userAgent ?? null,
          ipHash: meta?.ipHash ?? null,
        },
      });
    });
  } else {
    await prisma.userSession.create({
      data: {
        userId,
        sessionTokenHash: tokenHash,
        expiresAt,
        userAgent: meta?.userAgent ?? null,
        ipHash: meta?.ipHash ?? null,
      },
    });
  }

  return { token, expiresAt };
}

/**
 * Create a session only when the credential generation observed during
 * password verification is still current. Prevents stale login after reset.
 * Issues the auth cookie only after the database transaction commits.
 */
export async function createUserSession(
  userId: string,
  meta?: {
    userAgent?: string;
    ipHash?: string;
    expectedCredentialGeneration?: number;
  },
): Promise<void> {
  const { token, expiresAt } = await createUserSessionToken(userId, meta);

  // Cookie only after the session row is durably committed.
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroyUserSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    const tokenHash = hashSessionToken(token);
    await prisma.userSession
      .deleteMany({ where: { sessionTokenHash: tokenHash } })
      .catch(() => {});
  }

  cookieStore.delete(COOKIE_NAME);
}

export async function getCurrentSessionTokenHash(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? hashSessionToken(token) : null;
}

export async function getOptionalCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) return null;

  const tokenHash = hashSessionToken(token);

  const session = await prisma.userSession.findUnique({
    where: { sessionTokenHash: tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          globalRole: true,
          status: true,
          preferredLocale: true,
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) {
    return null;
  }

  if (
    !session.lastSeenAt ||
    session.lastSeenAt < new Date(Date.now() - LAST_SEEN_UPDATE_INTERVAL_MS)
  ) {
    await prisma.userSession
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => {});
  }

  return session.user;
}

export async function getCurrentUser(): Promise<AuthUser> {
  const user = await getOptionalCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requireCurrentUser(): Promise<AuthUser> {
  return getCurrentUser();
}

export async function requireActiveUser(returnUrl?: string): Promise<AuthUser> {
  const user = await getOptionalCurrentUser();

  if (!user) {
    const loginUrl = returnUrl
      ? `/login?returnUrl=${encodeURIComponent(returnUrl)}`
      : "/login";
    redirect(loginUrl);
  }

  if (isAdmin(user)) return user;

  if (user.status === "PENDING_APPROVAL") {
    redirect("/pending-approval");
  }

  if (user.status === "REJECTED") {
    redirect("/account/rejected");
  }

  if (user.status === "BLOCKED") {
    redirect("/account/blocked");
  }

  if (user.status !== "ACTIVE") {
    redirect("/pending-approval");
  }

  return user;
}

export async function requireAdminUser(returnUrl = "/admin"): Promise<AuthUser> {
  const user = await getOptionalCurrentUser();

  if (!user) {
    redirect(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  if (!isAdmin(user)) {
    redirect("/dashboard?error=access_denied");
  }

  // Bootstrap admins (ADMIN_EMAILS) always get through — required for system recovery.
  // Role-only admins (globalRole=ADMIN) must not be BLOCKED or REJECTED; they lose admin
  // access when blocked, preventing a blocked admin from self-approving via the panel.
  const isBootstrap = parseAdminEmails().includes(user.email.toLowerCase());
  if (!isBootstrap) {
    if (user.status === "BLOCKED") {
      redirect("/account/blocked");
    }
    if (user.status === "REJECTED") {
      redirect("/account/rejected");
    }
  }

  return user;
}

/**
 * Strict ACTIVE-admin gate for security-sensitive admin surfaces such as the
 * permanent email operations journal. Bootstrap emails do not bypass status.
 */
export async function requireActiveAdminUser(
  returnUrl = "/admin",
): Promise<AuthUser> {
  const user = await requireAdminUser(returnUrl);
  if (user.status !== "ACTIVE") {
    if (user.status === "BLOCKED") redirect("/account/blocked");
    if (user.status === "REJECTED") redirect("/account/rejected");
    redirect("/pending-approval");
  }
  return user;
}
