import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  fingerprintClientIpValue,
  getTrustedClientIdentity,
  normalizeClientIp,
  UNKNOWN_CLIENT_IP_BUCKET,
} from "@/lib/auth/client-ip";
import { TRUSTED_CLIENT_IP_HEADER } from "@/lib/auth/trusted-proxy";
import { ProcessLocalPasswordResetLimiter } from "@/lib/auth/password-reset-rate-limit";

const SECRET = "verify-stage313c-proxy-secret";

async function main() {
  const repoRoot = process.cwd();
  const snippet = await readFile(
    path.join(repoRoot, "deploy/nginx/trusted-client-ip-snippet.conf"),
    "utf8",
  );
  assert.match(snippet, /X-NegotAItions-Client-IP\s+\$remote_addr/);
  assert.match(snippet, /X-Real-IP\s+\$remote_addr/);
  assert.match(snippet, /X-Forwarded-For\s+\$remote_addr/);
  assert.doesNotMatch(
    snippet,
    /^[ \t]*proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for/m,
  );

  const packageJson = JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
  ) as { scripts: { start: string } };
  assert.match(packageJson.scripts.start, /-H\s+127\.0\.0\.1/);

  const envExample = await readFile(path.join(repoRoot, ".env.example"), "utf8");
  assert.match(envExample, /TRUSTED_PROXY_ENABLED="false"/);

  const unknown = fingerprintClientIpValue(UNKNOWN_CLIENT_IP_BUCKET, SECRET);
  const spoofHeaders: Array<Record<string, string>> = [
    { "x-forwarded-for": "198.51.100.1" },
    { "x-real-ip": "198.51.100.2" },
    { forwarded: "for=198.51.100.3" },
    { "cf-connecting-ip": "198.51.100.4" },
    { "true-client-ip": "198.51.100.5" },
    { [TRUSTED_CLIENT_IP_HEADER]: "198.51.100.6, 198.51.100.7" },
  ];
  let stableUnknown = 0;
  for (const init of spoofHeaders) {
    const identity = getTrustedClientIdentity(new Headers(init), {
      env: { TRUSTED_PROXY_ENABLED: "false", AUTH_SECRET: SECRET },
      hmacSecret: SECRET,
    });
    if (identity.fingerprint === unknown) stableUnknown += 1;
  }

  const trusted = getTrustedClientIdentity(
    new Headers({ [TRUSTED_CLIENT_IP_HEADER]: "192.0.2.44" }),
    {
      env: { TRUSTED_PROXY_ENABLED: "true", AUTH_SECRET: SECRET },
      hmacSecret: SECRET,
    },
  );
  assert.equal(trusted.source, "trusted-header");
  assert.equal(normalizeClientIp("::ffff:192.0.2.44"), "192.0.2.44");

  const limiter = new ProcessLocalPasswordResetLimiter(10, 2);
  assert.equal(
    limiter.consume({
      normalizedEmail: "a@example.com",
      clientIpFingerprint: unknown,
      now: 1,
    }),
    true,
  );
  assert.equal(
    limiter.consume({
      normalizedEmail: "b@example.com",
      clientIpFingerprint: unknown,
      now: 2,
    }),
    true,
  );
  assert.equal(
    limiter.consume({
      normalizedEmail: "c@example.com",
      clientIpFingerprint: unknown,
      now: 3,
    }),
    false,
  );

  console.log(
    JSON.stringify({
      ok: true,
      counts: {
        spoofHeadersCollapsedToUnknown: stableUnknown,
        trustedHeaderAccepted: trusted.source === "trusted-header" ? 1 : 0,
        snippetOverwriteDirectives: 3,
        localhostBindConfigured: 1,
      },
    }),
  );
}

void main().catch((error: unknown) => {
  process.exitCode = 1;
  const message = error instanceof Error ? error.message : "VERIFICATION_FAILED";
  console.error(
    JSON.stringify({
      ok: false,
      counts: { failures: 1 },
      names: { reason: [message] },
    }),
  );
});
