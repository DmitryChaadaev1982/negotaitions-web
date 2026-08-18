import {
  YANDEX_METRICA_INIT_OPTIONS,
  YANDEX_METRICA_SCRIPT_SRC,
  parseYandexMetricaCounterId,
  toMetricaHitPath,
} from "@/lib/analytics/yandex-metrica";

type YmFunction = ((
  id: number,
  method: string,
  ...args: unknown[]
) => void) & {
  a?: unknown[][];
  l?: number;
};

type MetricaWindow = Window & {
  ym?: YmFunction;
};

let initializedCounterId: string | null = null;
let lastHitPath: string | null = null;
let pendingDestructTimer: ReturnType<typeof setTimeout> | null = null;

function getMetricaWindow(): MetricaWindow | null {
  if (typeof globalThis === "undefined") {
    return null;
  }
  return ((globalThis as { window?: MetricaWindow }).window ?? null);
}

function cancelPendingDestruct(): void {
  if (pendingDestructTimer === null) {
    return;
  }
  clearTimeout(pendingDestructTimer);
  pendingDestructTimer = null;
}

export function installYmStub(): void {
  const w = getMetricaWindow();
  if (!w || typeof w.ym === "function") {
    return;
  }
  const ym = ((...args: unknown[]) => {
    ym.a = ym.a || [];
    ym.a.push(args);
  }) as YmFunction;
  ym.l = Date.now();
  w.ym = ym;
}

export function initYandexMetrica(counterId: string): boolean {
  cancelPendingDestruct();
  const id = parseYandexMetricaCounterId(counterId);
  const w = getMetricaWindow();
  if (!id || !w) {
    return false;
  }
  installYmStub();
  if (initializedCounterId === id) {
    return true;
  }
  w.ym?.(Number(id), "init", { ...YANDEX_METRICA_INIT_OPTIONS });
  initializedCounterId = id;
  lastHitPath = null;
  return true;
}

export function hitYandexMetrica(counterId: string, pathname: string): void {
  if (initializedCounterId === null) {
    return;
  }
  const id = parseYandexMetricaCounterId(counterId);
  const w = getMetricaWindow();
  if (!id || initializedCounterId !== id || !w || typeof w.ym !== "function") {
    return;
  }
  const path = toMetricaHitPath(pathname);
  if (lastHitPath === path) {
    return;
  }
  w.ym(Number(id), "hit", path);
  lastHitPath = path;
}

export function destructYandexMetrica(): void {
  cancelPendingDestruct();
  const id = initializedCounterId;
  const w = getMetricaWindow();
  if (id && w && typeof w.ym === "function") {
    w.ym(Number(id), "destruct");
  }
  initializedCounterId = null;
  lastHitPath = null;
}

/**
 * Delay destruct so React Strict Mode remount can cancel it and reuse the
 * same counter instead of a duplicate init/hit cycle.
 */
export function scheduleYandexMetricaDestruct(): void {
  if (initializedCounterId === null) {
    return;
  }
  cancelPendingDestruct();
  pendingDestructTimer = setTimeout(() => {
    pendingDestructTimer = null;
    destructYandexMetrica();
  }, 0);
}

export function syncYandexMetrica(args: {
  counterId: string | null;
  analyticsConsent: boolean;
  pathname: string;
}): void {
  const id = parseYandexMetricaCounterId(args.counterId);
  if (!id || !args.analyticsConsent) {
    destructYandexMetrica();
    return;
  }
  initYandexMetrica(id);
  hitYandexMetrica(id, args.pathname);
}

export function disableYandexMetrica(): void {
  destructYandexMetrica();
}

export function isYandexMetricaInitialized(): boolean {
  return initializedCounterId !== null;
}

export function getInitializedMetricaCounterId(): string | null {
  return initializedCounterId;
}

export function hasMetricaScriptInDocument(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return [...document.scripts].some(
    (script) =>
      script.src.includes("mc.yandex.ru/metrika/tag.js") ||
      script.src.includes(YANDEX_METRICA_SCRIPT_SRC),
  );
}

export function resetMetricaClientStateForTests(): void {
  cancelPendingDestruct();
  initializedCounterId = null;
  lastHitPath = null;
}
