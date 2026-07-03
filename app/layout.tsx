import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ClientI18nProvider } from "@/components/client-i18n-provider";
import { CookieBanner } from "@/components/cookie-banner";
import { BrowserCapabilityWarning } from "@/components/browser-capability-warning";
import { getServerLocale } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import { SiteFooter } from "@/components/site-footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function getLocaleMetadata(locale: Locale): Metadata {
  const ruLocale = locale === "ru";
  const title = ruLocale
    ? "ПереговорИИ — AI-тренажер переговоров"
    : "NegotAItions — AI-powered negotiation training";
  const description = ruLocale
    ? "Платформа для тренировки переговоров с AI-поддержкой для фасилитаторов и команд."
    : "AI-powered negotiation training platform for facilitators and teams.";

  return {
    title: {
      default: title,
      template: `%s | ${ruLocale ? "ПереговорИИ" : "NegotAItions"}`,
    },
    description,
    icons: {
      icon: [
        {
          url: "/brand/negotaitions-icon-32.png?v=20260703-localized",
          type: "image/png",
          sizes: "32x32",
        },
        {
          url: "/brand/negotaitions-icon-16.png?v=20260703-localized",
          type: "image/png",
          sizes: "16x16",
        },
        {
          url: "/icon.png?v=20260703-localized",
          type: "image/png",
          sizes: "512x512",
        },
        {
          url: "/brand/negotaitions-icon.png?v=20260703-localized",
          type: "image/png",
          sizes: "512x512",
        },
      ],
      apple: [{ url: "/apple-icon.png?v=20260703-localized", sizes: "180x180" }],
      shortcut: ["/brand/negotaitions-icon-32.png?v=20260703-localized"],
    },
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

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ colorScheme: "dark" }}
    >
      <body className="min-h-full flex flex-col bg-[#020617] text-slate-50">
        <ClientI18nProvider initialLocale={locale}>
          {children}
          <SiteFooter />
          <CookieBanner />
          <BrowserCapabilityWarning />
        </ClientI18nProvider>
      </body>
    </html>
  );
}
