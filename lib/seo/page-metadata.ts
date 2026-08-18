import type { Metadata } from "next";

import type { Locale } from "@/lib/i18n/config";
import { toCanonicalUrl } from "@/lib/seo/canonical";
import { getPublicSeoCopy } from "@/lib/seo/copy";
import {
  legalIndexingMetadata,
  publicIndexingMetadata,
  type PublicIndexablePath,
} from "@/lib/seo/indexing";
import { PUBLIC_CANONICAL_ORIGIN, PUBLIC_OG_IMAGE_SIZE } from "@/lib/seo/site";

export function getMetadataBase(): URL {
  return new URL(PUBLIC_CANONICAL_ORIGIN);
}

export function buildPublicMarketingMetadata(args: {
  locale: Locale;
  pathname: PublicIndexablePath;
}): Metadata {
  const copy = getPublicSeoCopy(args.locale);
  const page = copy.pages[args.pathname];
  const canonical = toCanonicalUrl(args.pathname);
  const isHome = args.pathname === "/";

  return {
    metadataBase: getMetadataBase(),
    ...publicIndexingMetadata,
    title: isHome ? { absolute: page.title } : page.title,
    description: page.description,
    alternates: {
      canonical,
    },
    openGraph: {
      type: "website",
      locale: args.locale === "ru" ? "ru_RU" : "en_US",
      url: canonical,
      siteName: copy.siteName,
      title: page.title,
      description: page.description,
      images: [
        {
          url: "/opengraph-image",
          width: PUBLIC_OG_IMAGE_SIZE.width,
          height: PUBLIC_OG_IMAGE_SIZE.height,
          alt: copy.ogImageAlt,
          type: "image/png",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
    },
  };
}

export function buildLegalDocumentMetadata(args: {
  pathname: string;
  title: string;
}): Metadata {
  const canonical = toCanonicalUrl(args.pathname);
  return {
    metadataBase: getMetadataBase(),
    ...legalIndexingMetadata,
    title: args.title,
    alternates: {
      canonical,
    },
  };
}
