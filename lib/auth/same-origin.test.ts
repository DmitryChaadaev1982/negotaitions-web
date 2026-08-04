import assert from "node:assert/strict";
import test from "node:test";

import { isSameOriginRequest } from "@/lib/auth/same-origin";

test("same-origin validation supports direct and trusted proxy request origins", () => {
  assert.equal(
    isSameOriginRequest(
      new Request("http://127.0.0.1:3100/api/auth/forgot-password", {
        headers: { origin: "http://127.0.0.1:3100" },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginRequest(
      new Request("http://127.0.0.1:3000/api/auth/forgot-password", {
        headers: {
          origin: "https://local.negotaitions.ru",
          host: "127.0.0.1:3000",
          "x-forwarded-host": "local.negotaitions.ru",
          "x-forwarded-proto": "https",
        },
      }),
    ),
    true,
  );
});

test("same-origin validation rejects absent, malformed, and cross-site origins", () => {
  const url = "http://127.0.0.1:3100/api/auth/forgot-password";
  assert.equal(isSameOriginRequest(new Request(url)), false);
  assert.equal(
    isSameOriginRequest(
      new Request(url, { headers: { origin: "not-a-url" } }),
    ),
    false,
  );
  assert.equal(
    isSameOriginRequest(
      new Request(url, { headers: { origin: "https://cross-origin.invalid" } }),
    ),
    false,
  );
});

