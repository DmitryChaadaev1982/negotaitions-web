import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ClientI18nProvider } from "@/components/client-i18n-provider";
import { CookieBanner } from "@/components/cookie-banner";
import { BrowserCapabilityWarning } from "@/components/browser-capability-warning";
import { getOptionalCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import { SiteFooter } from "@/components/site-footer";
import { getPublicSeoCopy } from "@/lib/seo/copy";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function getLocaleMetadata(locale: Locale): Metadata {
  const copy = getPublicSeoCopy(locale);

  return {
    title: {
      default: copy.pages["/"].title,
      template: `%s | ${copy.siteName}`,
    },
    description: copy.pages["/"].description,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return getLocaleMetadata(locale);
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getServerLocale();
  const user = await getOptionalCurrentUser();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ colorScheme: "dark" }}
    >
      <body className="min-h-full flex flex-col bg-[#020617] text-slate-50">
        <ClientI18nProvider initialLocale={locale}>
          {children}
          <SiteFooter
            isAuthenticated={Boolean(user)}
            isActive={user?.status === "ACTIVE"}
          />
          <CookieBanner />
          <BrowserCapabilityWarning />
        </ClientI18nProvider>
      </body>
    </html>
  );
}
