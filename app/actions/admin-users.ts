"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { parseAdminEmails } from "@/lib/auth/admin";
import { requireAdminUser } from "@/lib/auth";

const USER_STATUS = {
  PENDING_APPROVAL: "PENDING_APPROVAL",
  ACTIVE: "ACTIVE",
  REJECTED: "REJECTED",
  BLOCKED: "BLOCKED",
} as const;

const USER_ROLE = {
  ADMIN: "ADMIN",
  USER: "USER",
} as const;

const ADMIN_ACTION = {
  USER_APPROVED: "USER_APPROVED",
  USER_REJECTED: "USER_REJECTED",
  USER_BLOCKED: "USER_BLOCKED",
  USER_UNBLOCKED: "USER_UNBLOCKED",
  USER_MADE_ADMIN: "USER_MADE_ADMIN",
  USER_ADMIN_REMOVED: "USER_ADMIN_REMOVED",
} as const;

type ManagedUser = {
  id: string;
  email: string;
  status: string;
  globalRole: string;
  approvedAt: Date | null;
  approvedByUserId: string | null;
};

function normalizeComment(comment?: string | null): string | null {
  const normalized = String(comment ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isBootstrapAdminEmail(email: string): boolean {
  const adminEmails = parseAdminEmails();
  return adminEmails.includes(email.toLowerCase());
}

async function getTargetUserOrThrow(userId: string): Promise<ManagedUser> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      status: true,
      globalRole: true,
      approvedAt: true,
      approvedByUserId: true,
    },
  });

  if (!target) {
    throw new Error("Target user not found.");
  }

  return target;
}

function isEffectiveAdminUser(user: { email: string; globalRole: string; status: string }) {
  const isAdminByRole = user.globalRole === USER_ROLE.ADMIN;
  const isAdminByBootstrap = isBootstrapAdminEmail(user.email);
  const isAllowedStatus =
    user.status !== USER_STATUS.BLOCKED && user.status !== USER_STATUS.REJECTED;
  return (isAdminByRole || isAdminByBootstrap) && isAllowedStatus;
}

async function countEffectiveAdmins(): Promise<number> {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      globalRole: true,
      status: true,
    },
  });

  return users.filter(isEffectiveAdminUser).length;
}

async function ensureSafetyChecks(
  adminUser: { id: string },
  target: ManagedUser,
  action: "reject" | "block" | "removeAdmin",
) {
  if (target.id === adminUser.id) {
    throw new Error("Self-action is not allowed.");
  }

  if (action === "removeAdmin" && isBootstrapAdminEmail(target.email)) {
    throw new Error("Cannot remove admin rights from a bootstrap admin.");
  }

  if (action === "removeAdmin" || action === "block" || action === "reject") {
    if (isEffectiveAdminUser(target)) {
      const effectiveAdmins = await countEffectiveAdmins();
      if (effectiveAdmins <= 1) {
        throw new Error("Action would leave the system without an effective admin.");
      }
    }
  }
}

function revalidateAdminPages() {
  revalidatePath("/admin");
  revalidatePath("/admin/users");
}

export async function approveUser(userId: string, comment?: string): Promise<void> {
  const adminUser = await requireAdminUser("/admin/users");
  const target = await getTargetUserOrThrow(userId);
  const normalizedComment = normalizeComment(comment);
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: target.id },
      data: {
        status: USER_STATUS.ACTIVE,
        approvedAt: now,
        approvedByUserId: adminUser.id,
        rejectedAt: null,
        rejectedByUserId: null,
        blockedAt: null,
        blockedByUserId: null,
        ...(normalizedComment ? { approvalComment: normalizedComment } : {}),
      },
    }),
    prisma.adminActionLog.create({
      data: {
        adminUserId: adminUser.id,
        targetUserId: target.id,
        action: ADMIN_ACTION.USER_APPROVED,
        comment: normalizedComment,
      },
    }),
  ]);

  revalidateAdminPages();
}

export async function rejectUser(userId: string, comment?: string): Promise<void> {
  const adminUser = await requireAdminUser("/admin/users");
  const target = await getTargetUserOrThrow(userId);
  const normalizedComment = normalizeComment(comment);

  await ensureSafetyChecks(adminUser, target, "reject");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: target.id },
      data: {
        status: USER_STATUS.REJECTED,
        rejectedAt: new Date(),
        rejectedByUserId: adminUser.id,
        ...(normalizedComment ? { approvalComment: normalizedComment } : {}),
      },
    }),
    prisma.adminActionLog.create({
      data: {
        adminUserId: adminUser.id,
        targetUserId: target.id,
        action: ADMIN_ACTION.USER_REJECTED,
        comment: normalizedComment,
      },
    }),
  ]);

  revalidateAdminPages();
}

export async function blockUser(userId: string, comment?: string): Promise<void> {
  const adminUser = await requireAdminUser("/admin/users");
  const target = await getTargetUserOrThrow(userId);
  const normalizedComment = normalizeComment(comment);

  await ensureSafetyChecks(adminUser, target, "block");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: target.id },
      data: {
        status: USER_STATUS.BLOCKED,
        blockedAt: new Date(),
        blockedByUserId: adminUser.id,
        ...(normalizedComment ? { approvalComment: normalizedComment } : {}),
      },
    }),
    prisma.adminActionLog.create({
      data: {
        adminUserId: adminUser.id,
        targetUserId: target.id,
        action: ADMIN_ACTION.USER_BLOCKED,
        comment: normalizedComment,
      },
    }),
  ]);

  revalidateAdminPages();
}

export async function unblockUser(userId: string, comment?: string): Promise<void> {
  const adminUser = await requireAdminUser("/admin/users");
  const target = await getTargetUserOrThrow(userId);
  const now = new Date();
  const normalizedComment = normalizeComment(comment);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: target.id },
      data: {
        status: USER_STATUS.ACTIVE,
        approvedAt: target.approvedAt ?? now,
        approvedByUserId: target.approvedByUserId ?? adminUser.id,
        blockedAt: null,
        blockedByUserId: null,
      },
    }),
    prisma.adminActionLog.create({
      data: {
        adminUserId: adminUser.id,
        targetUserId: target.id,
        action: ADMIN_ACTION.USER_UNBLOCKED,
        comment: normalizedComment,
      },
    }),
  ]);

  revalidateAdminPages();
}

export async function makeAdmin(userId: string): Promise<void> {
  const adminUser = await requireAdminUser("/admin/users");
  const target = await getTargetUserOrThrow(userId);
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: target.id },
      data: {
        globalRole: USER_ROLE.ADMIN,
        status: target.status === USER_STATUS.ACTIVE ? target.status : USER_STATUS.ACTIVE,
        approvedAt: target.approvedAt ?? now,
        approvedByUserId: target.approvedByUserId ?? adminUser.id,
        blockedAt: null,
        blockedByUserId: null,
        rejectedAt: null,
        rejectedByUserId: null,
      },
    }),
    prisma.adminActionLog.create({
      data: {
        adminUserId: adminUser.id,
        targetUserId: target.id,
        action: ADMIN_ACTION.USER_MADE_ADMIN,
      },
    }),
  ]);

  revalidateAdminPages();
}

export async function removeAdmin(userId: string): Promise<void> {
  const adminUser = await requireAdminUser("/admin/users");
  const target = await getTargetUserOrThrow(userId);

  await ensureSafetyChecks(adminUser, target, "removeAdmin");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: target.id },
      data: {
        globalRole: USER_ROLE.USER,
      },
    }),
    prisma.adminActionLog.create({
      data: {
        adminUserId: adminUser.id,
        targetUserId: target.id,
        action: ADMIN_ACTION.USER_ADMIN_REMOVED,
      },
    }),
  ]);

  revalidateAdminPages();
}

function parseFormValue(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function approveUserAction(formData: FormData): Promise<void> {
  await approveUser(parseFormValue(formData, "userId"), parseFormValue(formData, "comment"));
}

export async function rejectUserAction(formData: FormData): Promise<void> {
  await rejectUser(parseFormValue(formData, "userId"), parseFormValue(formData, "comment"));
}

export async function blockUserAction(formData: FormData): Promise<void> {
  await blockUser(parseFormValue(formData, "userId"), parseFormValue(formData, "comment"));
}

export async function unblockUserAction(formData: FormData): Promise<void> {
  await unblockUser(parseFormValue(formData, "userId"), parseFormValue(formData, "comment"));
}

export async function makeAdminAction(formData: FormData): Promise<void> {
  await makeAdmin(parseFormValue(formData, "userId"));
}

export async function removeAdminAction(formData: FormData): Promise<void> {
  await removeAdmin(parseFormValue(formData, "userId"));
}
