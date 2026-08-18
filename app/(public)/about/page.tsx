import type { Metadata } from "next";

import { PublicAboutPage } from "@/components/public-about-page";
import { getServerLocale } from "@/lib/i18n/server";
import { buildPublicMarketingMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return buildPublicMarketingMetadata({ locale, pathname: "/about" });
}

export default function AboutPage() {
  return <PublicAboutPage />;
}
