import { LanguageSwitcher } from "@/components/language-switcher";
import { RejoinNavLink } from "@/components/rejoin-page-view";
import { AppHeaderNav } from "@/components/app-header-nav";
import { AuthNav } from "@/components/auth-nav";

type AppHeaderProps = {
  isAdmin?: boolean;
};

export function AppHeader({ isAdmin: adminFlag = false }: AppHeaderProps) {
  return (
    <header className="glass-header sticky top-0 z-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <AppHeaderNav isAdmin={adminFlag} />
        <div className="flex flex-wrap items-center gap-3">
          <RejoinNavLink />
          <LanguageSwitcher />
          <AuthNav />
        </div>
      </div>
    </header>
  );
}
