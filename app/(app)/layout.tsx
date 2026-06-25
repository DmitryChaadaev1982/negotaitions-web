import { AppHeader } from "@/components/app-header";
import { AppShell } from "@/components/ui/app-shell";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getOptionalCurrentUser();
  const adminFlag = user ? isAdmin(user) : false;

  return (
    <div className="min-h-full bg-[#020617]">
      <AppHeader isAdmin={adminFlag} />
      <AppShell>{children}</AppShell>
    </div>
  );
}
