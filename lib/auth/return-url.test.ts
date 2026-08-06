import assert from "node:assert/strict";
import test from "node:test";

import { isSafeReturnUrl, sanitizeReturnUrl } from "@/lib/auth/return-url";

test("legitimate internal paths survive with query and fragment", () => {
  const cases: Array<[string, string]> = [
    ["/", "/"],
    ["/dashboard", "/dashboard"],
    ["/sessions/abc-123", "/sessions/abc-123"],
    ["/search?q=hello&page=2", "/search?q=hello&page=2"],
    ["/docs#section-3", "/docs#section-3"],
    ["/search?q=a%20b#top", "/search?q=a%20b#top"],
    ["  /dashboard  ", "/dashboard"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(sanitizeReturnUrl(input), expected, `failed for ${input}`);
    assert.equal(isSafeReturnUrl(input), true);
  }
});

test("backslash authorities cannot leave the trusted origin", () => {
  // The pre-existing defect: `/\example.com` is normalised by browsers into
  // the scheme-relative authority `//example.com`.
  const bypasses = [
    "/\\example.com",
    "/\\\\example.com",
    "/\\/example.com",
    "\\/example.com",
    "\\\\example.com",
    "/\\example.com/path",
    "/%5Cexample.com",
    "/%5c%5cexample.com",
    "/%255Cexample.com",
    "/\t\\example.com",
  ];
  for (const value of bypasses) {
    assert.equal(sanitizeReturnUrl(value), null, `accepted ${JSON.stringify(value)}`);
  }
});

test("scheme-relative and encoded slash bypasses are rejected", () => {
  const bypasses = [
    "//example.com",
    "///example.com",
    "//example.com/path",
    "/%2fexample.com",
    "/%2f%2fexample.com",
    "/%2F/example.com",
    "/%252f%252fexample.com",
  ];
  for (const value of bypasses) {
    assert.equal(sanitizeReturnUrl(value), null, `accepted ${JSON.stringify(value)}`);
  }
});

test("absolute URLs, userinfo tricks, and non-http schemes are rejected", () => {
  const bypasses = [
    "https://example.com",
    "http://example.com/path",
    "https://negotaitions.ru/dashboard",
    "https://user:pass@example.com",
    "//user@example.com",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "mailto:victim@example.com",
    "file:///etc/passwd",
    "/@example.com".replace("/@", "//@"),
  ];
  for (const value of bypasses) {
    assert.equal(sanitizeReturnUrl(value), null, `accepted ${JSON.stringify(value)}`);
  }
});

test("control characters, whitespace tricks, and malformed encoding are rejected", () => {
  const bypasses = [
    "/\u0000dashboard",
    "/dash\nboard",
    "/dash\rboard",
    "/dash\tboard",
    "/\u0009/example.com",
    "/\u2028dashboard",
    "/\u200Bdashboard",
    "/\uFEFFdashboard",
    "/%",
    "/%zz",
    "/%e0%a4%a",
    "/dash%00board",
    "/dash%0aboard",
  ];
  for (const value of bypasses) {
    assert.equal(sanitizeReturnUrl(value), null, `accepted ${JSON.stringify(value)}`);
  }

  // Trailing Unicode whitespace is stripped by the same trim a browser would
  // apply, so the surviving path is the trimmed internal path.
  assert.equal(sanitizeReturnUrl("/dashboard\u00A0"), "/dashboard");
});

test("non-string, empty, relative, and oversized inputs are rejected", () => {
  for (const value of [
    null,
    undefined,
    "",
    "   ",
    "dashboard",
    "./dashboard",
    "../dashboard",
    `/${"a".repeat(4096)}`,
  ]) {
    assert.equal(sanitizeReturnUrl(value as string | null | undefined), null);
    assert.equal(isSafeReturnUrl(value as string | null | undefined), false);
  }
});

test("every accepted value resolves back to the same internal path", () => {
  // Property check: whatever survives must itself be accepted unchanged, so no
  // second normalisation pass in a browser can change the target origin.
  const candidates = [
    "/",
    "/a/b/c",
    "/a?b=c",
    "/a#b",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "/%2fevil.example",
    "/ok/path?x=1#y",
  ];
  for (const candidate of candidates) {
    const sanitized = sanitizeReturnUrl(candidate);
    if (sanitized === null) continue;
    assert.equal(sanitizeReturnUrl(sanitized), sanitized);
    const resolved = new URL(sanitized, "https://negotaitions.ru");
    assert.equal(resolved.origin, "https://negotaitions.ru");
  }
});
