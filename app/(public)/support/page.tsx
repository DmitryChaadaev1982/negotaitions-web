import type { Metadata } from "next";

import { PublicSupportPage } from "@/components/public-support-page";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getServerLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return { title: getDictionary(locale).publicSupport.title };
}

export default function SupportPage() {
  return <PublicSupportPage />;
}
