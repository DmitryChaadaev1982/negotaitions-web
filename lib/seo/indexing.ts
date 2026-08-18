import type { Metadata } from "next";

export const PUBLIC_CONTACT_EMAIL = "support@negotaitions.ru";
export const PUBLIC_CONTACT_MAILTO = `mailto:${PUBLIC_CONTACT_EMAIL}`;

export const PUBLIC_INDEXABLE_PATHS = ["/", "/about", "/support", "/faq"] as const;

export type PublicIndexablePath = (typeof PUBLIC_INDEXABLE_PATHS)[number];

export const LEGAL_DOCUMENT_PATHS = [
  "/privacy",
  "/terms",
  "/cookie-policy",
  "/data-processing-consent",
  "/ai-processing-notice",
] as const;

export const ROBOTS_DISALLOW_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/pending-approval",
  "/account",
  "/dashboard",
  "/cases",
  "/events",
  "/sessions",
  "/admin",
  "/join",
  "/rejoin",
  "/room",
  "/legal-update",
  "/voximplant-test",
  "/api",
] as const;

const PRIVATE_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/pending-approval",
  "/account",
  "/dashboard",
  "/cases",
  "/events",
  "/sessions",
  "/admin",
  "/join",
  "/rejoin",
  "/room",
  "/legal-update",
  "/voximplant-test",
  "/api",
] as const;

const PUBLIC_INDEXABLE_PATH_SET = new Set<string>(PUBLIC_INDEXABLE_PATHS);
const LEGAL_DOCUMENT_PATH_SET = new Set<string>(LEGAL_DOCUMENT_PATHS);

export const publicIndexingMetadata: Metadata = {
  robots: {
    index: true,
    follow: true,
  },
};

export const legalIndexingMetadata: Metadata = {
  robots: {
    index: false,
    follow: true,
    googleBot: {
      index: false,
      follow: true,
    },
  },
};

export const privateIndexingMetadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
  // Omit auto-generated canonical/og:url so token-bearing pathnames never
  // appear as public URLs in metadata.
  alternates: {
    canonical: null,
  },
  openGraph: {
    url: undefined,
  },
};

export function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? pathname;
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery || "/";
}

export function isPublicIndexablePath(pathname: string): boolean {
  return PUBLIC_INDEXABLE_PATH_SET.has(normalizePath(pathname));
}

export function isLegalDocumentPath(pathname: string): boolean {
  return LEGAL_DOCUMENT_PATH_SET.has(normalizePath(pathname));
}

export function isPublicAnalyticsPath(pathname: string): boolean {
  return isPublicIndexablePath(pathname);
}

export function isSitemapPath(pathname: string): boolean {
  return isPublicIndexablePath(pathname);
}

export function shouldNoindexPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (isPublicIndexablePath(path)) {
    return false;
  }
  if (isLegalDocumentPath(path)) {
    return true;
  }
  return PRIVATE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function shouldFollowPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (isPublicIndexablePath(path) || isLegalDocumentPath(path)) {
    return true;
  }
  return false;
}

export function isCredentialBearingPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return (
    path.startsWith("/join/") ||
    path.startsWith("/events/join/") ||
    path.startsWith("/room/")
  );
}
