#!/usr/bin/env node

const DEFAULT_TUNNEL_URL = "https://local.negotaitions.ru";
const REQUEST_TIMEOUT_MS = 7000;
const HEALTHY_STATUSES = new Set([200, 301, 302, 307, 308, 401, 403]);

function normalizeTarget(input) {
  try {
    const parsed = new URL(input);
    return parsed;
  } catch {
    throw new Error(`Invalid URL: "${input}"`);
  }
}

function classifyError(error) {
  if (!error || typeof error !== "object") return "unknown_error";
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  if (code === "ABORT_ERR") return "timeout";
  if (code === "ENOTFOUND") return "dns_resolution_failed";
  if (code === "ECONNREFUSED") return "connection_refused";
  if (code === "ECONNRESET") return "connection_reset";
  if (code === "ETIMEDOUT") return "timeout";
  if (message.toLowerCase().includes("certificate")) return "tls_certificate_error";
  if (message.toLowerCase().includes("tls")) return "tls_error";
  return "network_error";
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "negotiations-e2e-tunnel-preflight/1.0" },
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function printManualHelp() {
  console.error("\nLikely causes:");
  console.error("- VPN unavailable");
  console.error("- SSH reverse tunnel not running");
  console.error("- Remote reverse port unavailable");
  console.error("- Local dev server is not running on 127.0.0.1:3000");
  console.error("- Certificate/domain issue");

  console.error("\nManual PowerShell tunnel command:");
  console.error(
    "ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=2 -R 127.0.0.1:3300:127.0.0.1:3000 deploy@172.29.172.1",
  );

  console.error("\nRequired tunneled app env:");
  console.error("APP_URL=https://local.negotaitions.ru");
  console.error("BASE_URL=https://local.negotaitions.ru");
  console.error("NEXT_PUBLIC_APP_URL=https://local.negotaitions.ru");
}

async function main() {
  const targetRaw = process.env.E2E_TUNNEL_URL?.trim() || DEFAULT_TUNNEL_URL;
  const target = normalizeTarget(targetRaw);
  const loginUrl = new URL("/login", target);

  console.log("Reverse tunnel preflight");
  console.log(`Target URL: ${target.toString()}`);
  console.log(`Probe URL: ${loginUrl.toString()}`);
  console.log(`Timeout: ${REQUEST_TIMEOUT_MS}ms`);

  let response;
  try {
    response = await fetchWithTimeout(loginUrl);
  } catch (error) {
    const category = classifyError(error);
    console.error("\nTunnel preflight FAILED");
    console.error(`Target URL: ${target.toString()}`);
    console.error(`Error category: ${category}`);
    console.error(`Error details: ${error instanceof Error ? error.message : String(error)}`);
    printManualHelp();
    process.exit(1);
  }

  const { status } = response;
  if (!HEALTHY_STATUSES.has(status)) {
    console.error("\nTunnel preflight FAILED");
    console.error(`Target URL: ${target.toString()}`);
    console.error(`HTTP status: ${status}`);
    console.error(
      `Expected status: ${Array.from(HEALTHY_STATUSES).sort((a, b) => a - b).join(", ")}`,
    );
    printManualHelp();
    process.exit(1);
  }

  console.log(`HTTP status: ${status}`);
  console.log("Tunnel preflight passed.");
}

main().catch((error) => {
  console.error("Tunnel preflight FAILED");
  console.error(`Error category: ${classifyError(error)}`);
  console.error(`Error details: ${error instanceof Error ? error.message : String(error)}`);
  printManualHelp();
  process.exit(1);
});
