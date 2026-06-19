import { AppHeader } from "@/components/app-header";
import { getAppName } from "@/lib/config";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const appName = getAppName();

  return (
    <div className="min-h-full bg-slate-50">
      <AppHeader appName={appName} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
