export const YANDEX_METRICA_ID_ENV_KEY = "NEXT_PUBLIC_YANDEX_METRICA_ID";
const METRICA_ID_PATTERN = /^\d{6,12}$/;

export const YANDEX_METRICA_SCRIPT_SRC = "https://mc.yandex.ru/metrika/tag.js";

export type YandexMetricaInitOptions = {
  defer: true;
  clickmap: false;
  trackLinks: false;
  accurateTrackBounce: true;
  webvisor: false;
  ecommerce: false;
};

export const YANDEX_METRICA_INIT_OPTIONS: YandexMetricaInitOptions = {
  defer: true,
  clickmap: false,
  trackLinks: false,
  accurateTrackBounce: true,
  webvisor: false,
  ecommerce: false,
};

export function parseYandexMetricaCounterId(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!METRICA_ID_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function getYandexMetricaCounterId(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  return parseYandexMetricaCounterId(env[YANDEX_METRICA_ID_ENV_KEY]);
}

export function shouldLoadYandexMetrica(args: {
  counterId: string | null;
  analyticsConsent: boolean;
}): boolean {
  return Boolean(args.counterId && args.analyticsConsent);
}

/**
 * Privacy-safe SPA hit identifier: pathname only.
 * Query strings, hashes, and token-bearing URLs are never sent.
 */
export function toMetricaHitPath(pathname: string): string {
  const withoutQuery = pathname.split("?")[0] ?? "/";
  const withoutHash = withoutQuery.split("#")[0] ?? "/";
  if (!withoutHash.startsWith("/")) {
    return "/";
  }
  return withoutHash || "/";
}
