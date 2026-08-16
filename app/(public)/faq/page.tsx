import type { Metadata } from "next";

import { PublicFaqPage } from "@/components/public-faq-page";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getServerLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return { title: getDictionary(locale).publicFaq.title };
}

export default function FaqPage() {
  return <PublicFaqPage />;
}
