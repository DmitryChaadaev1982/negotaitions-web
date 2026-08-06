import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";

export function parseAdminEmails(): string[] {
  const raw = parseServerRuntimeSetting("ADMIN_EMAILS") as string;
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(user: { globalRole: string; email: string }): boolean {
  const adminEmails = parseAdminEmails();
  return (
    user.globalRole === "ADMIN" ||
    adminEmails.includes(user.email.toLowerCase())
  );
}

export function canAccessAdmin(user: {
  globalRole: string;
  email: string;
}): boolean {
  return isAdmin(user);
}
