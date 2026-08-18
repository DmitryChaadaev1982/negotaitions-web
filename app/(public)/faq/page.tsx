import type { Metadata } from "next";

import { PublicFaqPage } from "@/components/public-faq-page";
import { getServerLocale } from "@/lib/i18n/server";
import { buildPublicMarketingMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return buildPublicMarketingMetadata({ locale, pathname: "/faq" });
}

export default function FaqPage() {
  return <PublicFaqPage />;
}
