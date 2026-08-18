import { PUBLIC_CANONICAL_ORIGIN } from "@/lib/seo/site";

/**
 * Production canonical URLs always use the public HTTPS host and the
 * pathname only. Query strings (returnTo, UTM, tokens) are never part of
 * a canonical or Open Graph URL.
 */
export function normalizeCanonicalPath(pathname: string): string {
  const raw = pathname.trim() || "/";
  const withoutQuery = raw.split("?")[0]?.split("#")[0] ?? "/";
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery || "/";
}

export function toCanonicalUrl(pathname: string): string {
  const path = normalizeCanonicalPath(pathname);
  if (path === "/") {
    return PUBLIC_CANONICAL_ORIGIN;
  }
  return `${PUBLIC_CANONICAL_ORIGIN}${path}`;
}
