"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CookieSettingsButton } from "@/components/cookie-banner";
import { useI18n } from "@/lib/i18n/useI18n";
import { PUBLIC_CONTACT_MAILTO } from "@/lib/seo/indexing";

const HIDDEN_FOOTER_ROUTE_PATTERNS = [
  /^\/room\//,
  /^\/events\/[^/]+\/lobby$/,
];

function shouldHideFooter(pathname: string) {
  return HIDDEN_FOOTER_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

type FooterLink = {
  href: string;
  label: string;
  testId?: string;
  external?: boolean;
};

type SiteFooterProps = {
  isAuthenticated?: boolean;
  isActive?: boolean;
};

export function SiteFooter({
  isAuthenticated = false,
  isActive = false,
}: SiteFooterProps) {
  const pathname = usePathname();
  const { t } = useI18n();

  if (shouldHideFooter(pathname)) {
    return null;
  }

  const platformLinks: FooterLink[] = [
    { href: "/", label: t("footer.home"), testId: "footer-home" },
  ];

  if (isAuthenticated && isActive) {
    platformLinks.push({
      href: "/dashboard",
      label: t("nav.goToPlatform"),
      testId: "footer-platform",
    });
  } else if (!isAuthenticated) {
    platformLinks.push(
      { href: "/login", label: t("auth.login"), testId: "footer-login" },
      { href: "/register", label: t("auth.register"), testId: "footer-register" },
    );
  }

  const informationLinks: FooterLink[] = [
    {
      href: PUBLIC_CONTACT_MAILTO,
      label: t("footer.contact"),
      testId: "footer-contact",
      external: true,
    },
  ];

  const documentLinks: FooterLink[] = [
    { href: "/privacy", label: t("footer.privacy"), testId: "footer-privacy" },
    { href: "/terms", label: t("footer.termsOfUse"), testId: "footer-terms" },
    { href: "/cookie-policy", label: t("footer.cookie"), testId: "footer-cookie" },
    {
      href: "/data-processing-consent",
      label: t("footer.dataProcessingConsent"),
      testId: "footer-consent",
    },
    {
      href: "/ai-processing-notice",
      label: t("footer.aiProcessingNotice"),
      testId: "footer-ai-notice",
    },
  ];

  const groups = [
    { title: t("footer.platform"), links: platformLinks },
    { title: t("footer.information"), links: informationLinks },
    { title: t("footer.documents"), links: documentLinks },
  ];

  return (
    <footer
      data-testid="site-footer"
      className="mt-auto border-t border-cyan-900/40 bg-[#02040d]"
    >
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <div key={group.title}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {group.title}
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {group.links.map((item) => (
                  <li key={`${item.href}-${item.label}`}>
                    {item.external ? (
                      <a
                        href={item.href}
                        data-testid={item.testId}
                        className="font-medium text-slate-200 transition-colors hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        data-testid={item.testId}
                        className="font-medium text-slate-200 transition-colors hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 space-y-3 border-t border-cyan-900/40 pt-5 text-xs leading-6 text-slate-400">
          <p>{t("footer.copyright")}</p>
          <p>{t("footer.ipNotice")}</p>
          <CookieSettingsButton />
        </div>
      </div>
    </footer>
  );
}
