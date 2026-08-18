import type { MetadataRoute } from "next";

import { getSitemapEntries } from "@/lib/seo/sitemap-pages";

export default function sitemap(): MetadataRoute.Sitemap {
  return getSitemapEntries();
}
