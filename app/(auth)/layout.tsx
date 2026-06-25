import Link from "next/link";

import { BrandLogo } from "@/components/ui/brand-logo";

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
          <nav className="flex items-center gap-3 text-sm">
            <Link
              href="/login"
              className="text-slate-400 hover:text-slate-100 transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-cyan-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
            >
              Register
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        {children}
      </main>
    </div>
  );
}
