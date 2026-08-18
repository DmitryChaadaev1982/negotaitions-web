import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  YANDEX_METRICA_INIT_OPTIONS,
  getYandexMetricaCounterId,
  parseYandexMetricaCounterId,
  shouldLoadYandexMetrica,
  toMetricaHitPath,
} from "@/lib/analytics/yandex-metrica";
import {
  destructYandexMetrica,
  getInitializedMetricaCounterId,
  hitYandexMetrica,
  initYandexMetrica,
  installYmStub,
  isYandexMetricaInitialized,
  resetMetricaClientStateForTests,
  scheduleYandexMetricaDestruct,
  syncYandexMetrica,
} from "@/lib/analytics/yandex-metrica-client";

type YmCall = unknown[];

function installYmWindow() {
  const calls: YmCall[] = [];
  const ym = Object.assign(
    (...args: unknown[]) => {
      calls.push(args);
    },
    { a: [] as unknown[][], l: Date.now() },
  );
  (globalThis as { window?: unknown }).window = { ym };
  return { calls, ym };
}

function teardownYmWindow() {
  delete (globalThis as { window?: unknown }).window;
  resetMetricaClientStateForTests();
}

test("Metrica stays disabled without a valid counter ID", () => {
  assert.equal(parseYandexMetricaCounterId(undefined), null);
  assert.equal(parseYandexMetricaCounterId(""), null);
  assert.equal(parseYandexMetricaCounterId("abc"), null);
  assert.equal(parseYandexMetricaCounterId("123"), null);
  assert.equal(getYandexMetricaCounterId({}), null);
  assert.equal(
    shouldLoadYandexMetrica({ counterId: null, analyticsConsent: true }),
    false,
  );
});

test("Metrica loads only with a valid counter ID and analytics consent", () => {
  assert.equal(parseYandexMetricaCounterId("12345678"), "12345678");
  assert.equal(
    getYandexMetricaCounterId({ NEXT_PUBLIC_YANDEX_METRICA_ID: "12345678" }),
    "12345678",
  );
  assert.equal(
    shouldLoadYandexMetrica({ counterId: "12345678", analyticsConsent: false }),
    false,
  );
  assert.equal(
    shouldLoadYandexMetrica({ counterId: "12345678", analyticsConsent: true }),
    true,
  );
});

test("privacy-minimized SPA init uses defer and disables Webvisor, ecommerce, and clickmap", () => {
  assert.equal(YANDEX_METRICA_INIT_OPTIONS.defer, true);
  assert.equal(YANDEX_METRICA_INIT_OPTIONS.webvisor, false);
  assert.equal(YANDEX_METRICA_INIT_OPTIONS.ecommerce, false);
  assert.equal(YANDEX_METRICA_INIT_OPTIONS.clickmap, false);
  assert.equal("userParams" in YANDEX_METRICA_INIT_OPTIONS, false);
  assert.equal("ssr" in YANDEX_METRICA_INIT_OPTIONS, false);
  assert.doesNotMatch(
    JSON.stringify(YANDEX_METRICA_INIT_OPTIONS),
    /email|userId|sessionId|userParams/,
  );
});

test("hit paths are pathname-only and drop query, hash, and token-bearing suffixes", () => {
  assert.equal(toMetricaHitPath("/"), "/");
  assert.equal(toMetricaHitPath("/about"), "/about");
  assert.equal(toMetricaHitPath("/faq?returnTo=/dashboard"), "/faq");
  assert.equal(toMetricaHitPath("/support#session=abc"), "/support");
  assert.equal(
    toMetricaHitPath("/?hostToken=secret&joinToken=secret"),
    "/",
  );
});

test("consent true initializes once with defer and sends exactly one current-path hit", () => {
  resetMetricaClientStateForTests();
  const { calls } = installYmWindow();
  try {
    installYmStub();
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: true,
      pathname: "/",
    });
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: true,
      pathname: "/",
    });
    assert.equal(isYandexMetricaInitialized(), true);
    assert.equal(getInitializedMetricaCounterId(), "12345678");
    assert.equal(calls.filter((call) => call[1] === "init").length, 1);
    assert.equal(calls.filter((call) => call[1] === "hit").length, 1);
    assert.deepEqual(calls[0]?.[2], YANDEX_METRICA_INIT_OPTIONS);
    assert.equal(calls[1]?.[1], "hit");
    assert.equal(calls[1]?.[2], "/");
  } finally {
    teardownYmWindow();
  }
});

test("client public navigation sends exactly one hit for the new pathname", () => {
  resetMetricaClientStateForTests();
  const { calls } = installYmWindow();
  try {
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: true,
      pathname: "/",
    });
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: true,
      pathname: "/about",
    });
    const hits = calls.filter((call) => call[1] === "hit");
    assert.equal(calls.filter((call) => call[1] === "init").length, 1);
    assert.equal(hits.length, 2);
    assert.equal(hits[0]?.[2], "/");
    assert.equal(hits[1]?.[2], "/about");
  } finally {
    teardownYmWindow();
  }
});

test("same pathname rerender does not duplicate hit", () => {
  resetMetricaClientStateForTests();
  const { calls } = installYmWindow();
  try {
    initYandexMetrica("12345678");
    hitYandexMetrica("12345678", "/faq");
    hitYandexMetrica("12345678", "/faq");
    hitYandexMetrica("12345678", "/faq?returnTo=/login");
    assert.equal(calls.filter((call) => call[1] === "hit").length, 1);
    assert.equal(calls.find((call) => call[1] === "hit")?.[2], "/faq");
  } finally {
    teardownYmWindow();
  }
});

test("consent true -> false calls destruct and blocks later hits", () => {
  resetMetricaClientStateForTests();
  const { calls } = installYmWindow();
  try {
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: true,
      pathname: "/",
    });
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: false,
      pathname: "/about",
    });
    hitYandexMetrica("12345678", "/faq");
    const methods = calls.map((call) => call[1]);
    assert.ok(methods.includes("init"));
    assert.ok(methods.includes("destruct"));
    assert.equal(getInitializedMetricaCounterId(), null);
    assert.equal(calls.filter((call) => call[1] === "hit").length, 1);
    assert.equal(calls.filter((call) => call[1] === "destruct").length, 1);
  } finally {
    teardownYmWindow();
  }
});

test("consent false -> true again performs a clean init and one current-path hit", () => {
  resetMetricaClientStateForTests();
  const { calls } = installYmWindow();
  try {
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: true,
      pathname: "/",
    });
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: false,
      pathname: "/",
    });
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: true,
      pathname: "/support",
    });
    const inits = calls.filter((call) => call[1] === "init");
    const hits = calls.filter((call) => call[1] === "hit");
    const destructs = calls.filter((call) => call[1] === "destruct");
    assert.equal(inits.length, 2);
    assert.equal(destructs.length, 1);
    assert.equal(hits.length, 2);
    assert.equal(hits[1]?.[2], "/support");
    assert.deepEqual(inits[1]?.[2], YANDEX_METRICA_INIT_OPTIONS);
  } finally {
    teardownYmWindow();
  }
});

test("ID absent or no consent never init or hit", () => {
  resetMetricaClientStateForTests();
  const { calls } = installYmWindow();
  try {
    syncYandexMetrica({
      counterId: null,
      analyticsConsent: true,
      pathname: "/",
    });
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: false,
      pathname: "/",
    });
    assert.equal(calls.length, 0);
    assert.equal(isYandexMetricaInitialized(), false);
  } finally {
    teardownYmWindow();
  }
});

test("leaving public scope destructs an initialized counter after the deferred teardown", () => {
  resetMetricaClientStateForTests();
  const { calls } = installYmWindow();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: true,
      pathname: "/",
    });
    scheduleYandexMetricaDestruct();
    assert.equal(isYandexMetricaInitialized(), true);
    mock.timers.tick(0);
    assert.equal(isYandexMetricaInitialized(), false);
    assert.equal(calls.filter((call) => call[1] === "destruct").length, 1);
    hitYandexMetrica("12345678", "/about");
    assert.equal(calls.filter((call) => call[1] === "hit").length, 1);
  } finally {
    mock.timers.reset();
    teardownYmWindow();
  }
});

test("scheduled public-scope destruct is cancelled by a Strict Mode remount sync", () => {
  resetMetricaClientStateForTests();
  const { calls } = installYmWindow();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: true,
      pathname: "/",
    });
    scheduleYandexMetricaDestruct();
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: true,
      pathname: "/",
    });
    mock.timers.tick(0);
    assert.equal(isYandexMetricaInitialized(), true);
    assert.equal(calls.filter((call) => call[1] === "init").length, 1);
    assert.equal(calls.filter((call) => call[1] === "hit").length, 1);
    assert.equal(calls.filter((call) => call[1] === "destruct").length, 0);
  } finally {
    mock.timers.reset();
    teardownYmWindow();
  }
});

test("hits never include user identity or query/token values", () => {
  resetMetricaClientStateForTests();
  const { calls } = installYmWindow();
  try {
    syncYandexMetrica({
      counterId: "12345678",
      analyticsConsent: true,
      pathname: "/about?participantToken=secret#user=1",
    });
    const serialized = JSON.stringify(calls);
    assert.doesNotMatch(serialized, /participantToken|secret|user=1|userParams/);
    assert.equal(calls.find((call) => call[1] === "hit")?.[2], "/about");
  } finally {
    teardownYmWindow();
  }
});
