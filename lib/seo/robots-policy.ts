import type { MetadataRoute } from "next";

import { ROBOTS_DISALLOW_PATHS } from "@/lib/seo/indexing";
import { PUBLIC_CANONICAL_ORIGIN, PUBLIC_SITEMAP_URL } from "@/lib/seo/site";

export function buildRobotsPolicy(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...ROBOTS_DISALLOW_PATHS],
      },
    ],
    sitemap: PUBLIC_SITEMAP_URL,
    host: PUBLIC_CANONICAL_ORIGIN,
  };
}
