import type { Metadata } from "next";

export const PUBLIC_CONTACT_EMAIL = "support@negotaitions.ru";
export const PUBLIC_CONTACT_MAILTO = `mailto:${PUBLIC_CONTACT_EMAIL}`;

export const publicIndexingMetadata: Metadata = {
  robots: {
    index: true,
    follow: true,
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
};

const PUBLIC_INDEXABLE_PATHS = new Set([
  "/",
  "/about",
  "/support",
  "/faq",
  "/privacy",
  "/terms",
  "/cookie-policy",
  "/data-processing-consent",
  "/ai-processing-notice",
]);

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
  "/voximplant-test",
];

function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split("?")[0] ?? pathname;
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery || "/";
}

export function isPublicIndexablePath(pathname: string): boolean {
  return PUBLIC_INDEXABLE_PATHS.has(normalizePath(pathname));
}

export function shouldNoindexPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (isPublicIndexablePath(path)) {
    return false;
  }
  return PRIVATE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
