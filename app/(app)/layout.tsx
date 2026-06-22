import { AppHeader } from "@/components/app-header";
import { AppShell } from "@/components/ui/app-shell";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-full bg-[#020617]">
      <AppHeader />
      <AppShell>{children}</AppShell>
    </div>
  );
}
