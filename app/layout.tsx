import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ClientI18nProvider } from "@/components/client-i18n-provider";
import { CookieBanner } from "@/components/cookie-banner";
import { BrowserCapabilityWarning } from "@/components/browser-capability-warning";
import { getServerLocale } from "@/lib/i18n/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "NegotAItions",
    template: "%s | NegotAItions",
  },
  description: "AI-powered negotiation training platform for facilitators",
};

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
          <CookieBanner />
          <BrowserCapabilityWarning />
        </ClientI18nProvider>
      </body>
    </html>
  );
}
