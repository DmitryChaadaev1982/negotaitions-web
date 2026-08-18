import type { MetadataRoute } from "next";

import { toCanonicalUrl } from "@/lib/seo/canonical";
import { PUBLIC_INDEXABLE_PATHS, isSitemapPath } from "@/lib/seo/indexing";

export function getSitemapEntries(): MetadataRoute.Sitemap {
  return PUBLIC_INDEXABLE_PATHS.map((pathname) => ({
    url: toCanonicalUrl(pathname),
  }));
}

export function sitemapContainsPath(pathname: string): boolean {
  return isSitemapPath(pathname);
}
