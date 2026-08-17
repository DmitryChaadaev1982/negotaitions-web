import { LEGAL_DOCUMENT_ROUTES } from "@/lib/legal/documents";
import { sanitizeNonCredentialReturnUrl } from "@/lib/legal/legal-update-return-url";
import { LEGAL_UPDATE_PATH } from "@/lib/legal/release";

export const LEGAL_RETURN_QUERY = {
  returnTo: "returnTo",
  returnContext: "returnContext",
} as const;

export const LEGAL_RETURN_CONTEXTS = [
  "legal-update",
  "register",
  "app",
  "site",
  "home",
] as const;

export type LegalReturnContext = (typeof LEGAL_RETURN_CONTEXTS)[number];

export type LegalDocumentReturn = {
  href: string;
  context: LegalReturnContext;
};

const CONTEXT_FALLBACK: Record<LegalReturnContext, string> = {
  "legal-update": LEGAL_UPDATE_PATH,
  register: "/register",
  app: "/dashboard",
  site: "/",
  home: "/",
};

const APP_PATH_PREFIXES = [
  "/dashboard",
  "/cases",
  "/events",
  "/sessions",
  "/admin",
  "/room",
  "/rejoin",
  "/join",
  "/account",
  "/pending-approval",
] as const;

const PUBLIC_SITE_PATHS = new Set(["/", "/about", "/support", "/faq"]);

export function isLegalReturnContext(
  value: string | null | undefined,
): value is LegalReturnContext {
  return (
    typeof value === "string" &&
    (LEGAL_RETURN_CONTEXTS as readonly string[]).includes(value)
  );
}

export function isLegalDocumentPath(pathWithQuery: string): boolean {
  let pathname = pathWithQuery;
  try {
    pathname = new URL(pathWithQuery, "https://internal.invalid").pathname;
  } catch {
    return true;
  }
  return (LEGAL_DOCUMENT_ROUTES as readonly string[]).includes(pathname);
}

/**
 * Safe legal-document return destination: origin-safe, non-credential, and
 * never another legal document (avoids return loops). Query and hash are
 * stripped so nested secrets such as `?returnUrl=/join/SECRET` cannot leak
 * into a legal-document URL.
 */
export function sanitizeLegalDocumentReturnUrl(
  raw: string | null | undefined,
): string | null {
  const sanitized = sanitizeNonCredentialReturnUrl(raw);
  if (!sanitized) return null;

  let pathname: string;
  try {
    pathname = new URL(sanitized, "https://internal.invalid").pathname;
  } catch {
    return null;
  }

  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
  if (isLegalDocumentPath(pathname)) return null;
  return pathname;
}

export function inferLegalReturnContext(
  pathname: string,
): LegalReturnContext {
  if (
    pathname === LEGAL_UPDATE_PATH ||
    pathname.startsWith(`${LEGAL_UPDATE_PATH}/`)
  ) {
    return "legal-update";
  }
  if (pathname === "/register" || pathname.startsWith("/register/")) {
    return "register";
  }
  if (
    APP_PATH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return "app";
  }
  if (PUBLIC_SITE_PATHS.has(pathname)) return "site";
  return "site";
}

/**
 * Context is label-only. The destination is independently sanitized and never
 * taken from context as authorization. A `/legal-update` destination always
 * keeps the legal-update label so a gated user is not told to return to the
 * platform.
 */
export function resolveLegalDocumentReturn(input: {
  returnTo?: string | null;
  returnContext?: string | null;
}): LegalDocumentReturn {
  const requestedContext = isLegalReturnContext(input.returnContext)
    ? input.returnContext
    : null;
  const safeReturnTo = sanitizeLegalDocumentReturnUrl(input.returnTo);

  if (safeReturnTo) {
    const inferred = inferLegalReturnContext(safeReturnTo);
    if (inferred === "legal-update") {
      return { href: safeReturnTo, context: "legal-update" };
    }
    if (requestedContext === "home" && safeReturnTo === "/") {
      return { href: "/", context: "home" };
    }
    if (requestedContext && requestedContext !== "home") {
      return { href: safeReturnTo, context: requestedContext };
    }
    return { href: safeReturnTo, context: inferred };
  }

  if (requestedContext) {
    return {
      href: CONTEXT_FALLBACK[requestedContext],
      context: requestedContext,
    };
  }

  return { href: "/", context: "home" };
}

export function buildLegalDocumentHref(
  documentPath: string,
  options?: {
    returnTo?: string | null;
    returnContext?: string | null;
  },
): string {
  if (!options?.returnTo && !options?.returnContext) {
    return documentPath;
  }

  const resolved = resolveLegalDocumentReturn({
    returnTo: options.returnTo,
    returnContext: options.returnContext,
  });
  const params = new URLSearchParams();
  params.set(LEGAL_RETURN_QUERY.returnTo, resolved.href);
  params.set(LEGAL_RETURN_QUERY.returnContext, resolved.context);
  return `${documentPath}?${params.toString()}`;
}

/**
 * Derive a safe return payload from the page the user is leaving. Legal
 * document pages preserve their existing sanitized return instead of looping
 * back to themselves.
 */
export function legalReturnFromLocation(
  pathname: string,
  search = "",
): { returnTo: string; returnContext: LegalReturnContext } {
  if (isLegalDocumentPath(pathname)) {
    const params = new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search,
    );
    const resolved = resolveLegalDocumentReturn({
      returnTo: params.get(LEGAL_RETURN_QUERY.returnTo),
      returnContext: params.get(LEGAL_RETURN_QUERY.returnContext),
    });
    return { returnTo: resolved.href, returnContext: resolved.context };
  }

  if (
    pathname === LEGAL_UPDATE_PATH ||
    pathname.startsWith(`${LEGAL_UPDATE_PATH}/`)
  ) {
    return { returnTo: LEGAL_UPDATE_PATH, returnContext: "legal-update" };
  }

  if (pathname === "/register" || pathname.startsWith("/register/")) {
    return { returnTo: "/register", returnContext: "register" };
  }

  const candidate = `${pathname}${search}`;
  const sanitized = sanitizeLegalDocumentReturnUrl(candidate);
  if (!sanitized) {
    if (inferLegalReturnContext(pathname) === "app") {
      return { returnTo: "/dashboard", returnContext: "app" };
    }
    return { returnTo: "/", returnContext: "home" };
  }

  return {
    returnTo: sanitized,
    returnContext: inferLegalReturnContext(sanitized),
  };
}
