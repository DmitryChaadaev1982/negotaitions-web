import assert from "node:assert/strict";
import test from "node:test";

import {
  buildObservedApplicationStartedLogFixture,
  sanitizePocDiagnosticLog,
} from "@/lib/voximplant/poc/log-sanitize";

test("18. full accessURL/accessSecureURL redacted from log diagnostics", () => {
  const accessURL =
    "http://example.voximplant.com/session/ACCESS-URL-SECRET-TOKEN-AAA";
  const accessSecureURL =
    "https://example.voximplant.com/session/ACCESS-SECURE-URL-SECRET-TOKEN-BBB";

  const fixture = buildObservedApplicationStartedLogFixture({
    accessURL,
    accessSecureURL,
    conferenceName: "neg-poc-server-stop-1",
  });

  const sanitized = sanitizePocDiagnosticLog(fixture);
  const serialized = JSON.stringify(sanitized);

  assert.ok(!serialized.includes(accessURL));
  assert.ok(!serialized.includes(accessSecureURL));
  assert.ok(!serialized.includes("ACCESS-URL-SECRET-TOKEN"));
  assert.ok(!serialized.includes("ACCESS-SECURE-URL-SECRET-TOKEN"));
  assert.ok(!serialized.includes("Bearer should-not-leak"));
  assert.equal(sanitized.headers, "[redacted-header-map]");
  assert.equal(sanitized.signature, "[redacted-signature]");
  assert.match(String(sanitized.accessURL), /^sha256:/);
  assert.match(String(sanitized.accessSecureURL), /^sha256:/);
});

test("never paste raw Application.Started capability URLs", () => {
  const raw = {
    name: "Application.Started",
    accessURL: "https://host/session/raw-a",
    accessSecureURL: "https://host/session/raw-b",
  };
  const out = sanitizePocDiagnosticLog(raw);
  assert.notEqual(out.accessURL, raw.accessURL);
  assert.notEqual(out.accessSecureURL, raw.accessSecureURL);
});
