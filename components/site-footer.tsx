"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/lib/i18n/useI18n";

const HIDDEN_FOOTER_ROUTE_PATTERNS = [
  /^\/room\//,
  /^\/events\/[^/]+\/lobby$/,
];

function shouldHideFooter(pathname: string) {
  return HIDDEN_FOOTER_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function SiteFooter() {
  const pathname = usePathname();
  const { t } = useI18n();

  if (shouldHideFooter(pathname)) {
    return null;
  }

  const footerLinks: Array<{
    key: "legalInformation" | "support" | "about" | "termsOfUse" | "faq";
    href?: string;
  }> = [
    { key: "legalInformation", href: "/privacy" },
    { key: "support" },
    { key: "about" },
    { key: "termsOfUse", href: "/terms" },
    { key: "faq" },
  ];

  return (
    <footer className="mt-auto border-t border-cyan-900/40 bg-[#02040d]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid grid-cols-2 gap-4 pb-6 text-sm sm:grid-cols-3 lg:grid-cols-5">
          {footerLinks.map((item) => (
            <div key={item.key} className="space-y-2">
              {item.href ? (
                <Link
                  href={item.href}
                  className="font-medium text-slate-200 transition-colors hover:text-cyan-300"
                >
                  {t(`footer.${item.key}`)}
                </Link>
              ) : (
                <span
                  aria-disabled
                  className="cursor-not-allowed font-medium text-slate-500/90"
                >
                  {t(`footer.${item.key}`)}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-cyan-900/40 pt-5 text-xs leading-6 text-slate-400">
          <p>{t("footer.copyright")}</p>
          <p>{t("footer.ipNotice")}</p>
        </div>
      </div>
    </footer>
  );
}
