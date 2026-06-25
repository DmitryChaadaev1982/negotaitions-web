import { BrandLogo } from "@/components/ui/brand-logo";
import { AuthLayoutNav } from "@/components/auth-layout-nav";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full flex flex-col">
      <header className="glass-header sticky top-0 z-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <BrandLogo size="md" href="/" />
          <AuthLayoutNav />
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        {children}
      </main>
    </div>
  );
}
