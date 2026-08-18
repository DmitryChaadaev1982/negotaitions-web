import type { Metadata } from "next";

import { PublicSupportPage } from "@/components/public-support-page";
import { getServerLocale } from "@/lib/i18n/server";
import { buildPublicMarketingMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return buildPublicMarketingMetadata({ locale, pathname: "/support" });
}

export default function SupportPage() {
  return <PublicSupportPage />;
}
