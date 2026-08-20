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
      <div className="mx-auto flex w-full flex-col gap-4 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:px-6 min-[72rem]:w-max min-[72rem]:min-w-[72rem] min-[72rem]:max-w-full">
        <AppHeaderNav isAdmin={adminFlag} />
        <div
          className="flex shrink-0 items-center gap-3"
          data-testid="app-header-utilities"
        >
          <RejoinNavLink />
          <LanguageSwitcher persistToServer />
          <AuthNav />
        </div>
      </div>
    </header>
  );
}
