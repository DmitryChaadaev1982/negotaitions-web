import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildSessionMaterialsUrl,
  getEventJoinUrl,
  getEventPublicJoinUrl,
  getPublicAppUrl,
} from "@/lib/config";

function withEnv<T>(
  patch: Record<string, string | undefined>,
  operation: () => T,
): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("public invite origin falls back to production canonical URL", () => {
  const origin = withEnv(
    {
      APP_URL: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
      EMAIL_CANONICAL_BASE_URL: undefined,
    },
    () => getPublicAppUrl(),
  );
  assert.equal(origin, "https://negotaitions.ru");
});

test("public invite origin ignores localhost and loopback values", () => {
  const fromLocalhost = withEnv(
    {
      APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_URL: undefined,
      EMAIL_CANONICAL_BASE_URL: undefined,
    },
    () => getPublicAppUrl(),
  );
  assert.equal(fromLocalhost, "https://negotaitions.ru");

  const fromLoopback = withEnv(
    {
      APP_URL: "https://127.0.0.1:3100",
      NEXT_PUBLIC_APP_URL: undefined,
      EMAIL_CANONICAL_BASE_URL: undefined,
    },
    () => getPublicAppUrl(),
  );
  assert.equal(fromLoopback, "https://negotaitions.ru");
});

test("public invite origin uses configured canonical https origin when valid", () => {
  const origin = withEnv(
    {
      APP_URL: "https://local.negotaitions.ru",
      NEXT_PUBLIC_APP_URL: undefined,
      EMAIL_CANONICAL_BASE_URL: undefined,
    },
    () => getPublicAppUrl(),
  );
  assert.equal(origin, "https://local.negotaitions.ru");
});

test("event and standalone session links use canonical public origin", () => {
  const links = withEnv(
    {
      APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_URL: undefined,
      EMAIL_CANONICAL_BASE_URL: undefined,
    },
    () => ({
      eventPrivate: getEventJoinUrl("evt_123"),
      eventPublic: getEventPublicJoinUrl("PUB123"),
      sessionStandalone: buildSessionMaterialsUrl("join_abc"),
    }),
  );

  assert.equal(links.eventPrivate, "https://negotaitions.ru/events/evt_123/join");
  assert.equal(links.eventPublic, "https://negotaitions.ru/events/join/PUB123");
  assert.equal(links.sessionStandalone, "https://negotaitions.ru/join/join_abc");
  assert.equal(links.eventPrivate.includes("localhost"), false);
  assert.equal(links.eventPublic.includes("127.0.0.1"), false);
  assert.equal(links.sessionStandalone.includes("localhost"), false);
});

test("event lobby copy-link path uses canonical URL helpers", () => {
  const source = readFileSync("components/event-lobby-view.tsx", "utf-8");
  assert.match(source, /getEventPublicJoinUrl\(state\.event\.publicJoinCode\)/);
  assert.match(source, /getEventJoinUrl\(eventId\)/);
  assert.doesNotMatch(source, /window\.location\.origin\/events/);
});
