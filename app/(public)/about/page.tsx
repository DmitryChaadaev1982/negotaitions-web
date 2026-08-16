import type { Metadata } from "next";

import { PublicAboutPage } from "@/components/public-about-page";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getServerLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return { title: getDictionary(locale).publicAbout.title };
}

export default function AboutPage() {
  return <PublicAboutPage />;
}
