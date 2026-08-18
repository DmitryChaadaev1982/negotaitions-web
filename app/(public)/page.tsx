import type { Metadata } from "next";

import { PublicHomePage } from "@/components/public-home-page";
import { getOptionalCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";
import { buildPublicMarketingMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return buildPublicMarketingMetadata({ locale, pathname: "/" });
}

export default async function PublicHome() {
  const user = await getOptionalCurrentUser();
  const isAuthenticated = Boolean(user);
  const isActive = user?.status === "ACTIVE";

  return (
    <PublicHomePage isAuthenticated={isAuthenticated} isActive={isActive} />
  );
}
