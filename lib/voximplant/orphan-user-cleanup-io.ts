import { spawn } from "node:child_process";

import { Client } from "pg";

import { getVoximplantConfig } from "@/lib/voximplant/config-settings";
import {
  deleteRemoteVoximplantUser,
  listRemoteVoximplantUsers,
} from "@/lib/voximplant/management-api-core";
import {
  collectExplicitPocUsernames,
  type AppUserRow,
  type DeleteCandidate,
  type KeepListLoadResult,
  type OrphanCleanupLoaders,
  type RemoteInventoryLoadResult,
  type RemoteVoxUser,
} from "@/lib/voximplant/orphan-user-cleanup";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PRODUCTION_SSH_DEFAULT_HOST = "negotaitions-poc";
const PRODUCTION_APP_DIR = "/var/www/negotaitions/app";

const USER_SELECT_SQL = `SELECT id, email, name FROM "User" ORDER BY id`;

type ConnectionTuple = {
  host: string;
  port: number;
  database: string;
};

function parseConnectionTuple(connectionString: string): ConnectionTuple {
  const parsed = new URL(connectionString);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Database URL must use the postgresql:// protocol.");
  }
  const database = parsed.pathname.replace(/^\//, "").split("?")[0]?.trim();
  if (!database) {
    throw new Error("Database URL must include a database name.");
  }
  return {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port ? Number(parsed.port) : 5432,
    database,
  };
}

function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.trim().toLowerCase());
}

function looksProductionLike(tuple: ConnectionTuple): boolean {
  return (
    /mdb\.yandexcloud|yandexcloud\.net/i.test(tuple.host) ||
    /negotaitions_poc|negotaitions_prod|negotiations_prod/i.test(tuple.database)
  );
}

async function queryUsers(
  connectionString: string,
): Promise<AppUserRow[]> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{
      id: string;
      email: string | null;
      name: string | null;
    }>(USER_SELECT_SQL);
    return result.rows.map((row) => ({
      id: String(row.id),
      email: row.email,
      name: row.name,
    }));
  } finally {
    await client.end();
  }
}

export function assertLocalManualDatabaseUrl(
  connectionString: string,
): ConnectionTuple {
  const tuple = parseConnectionTuple(connectionString);
  if (!isLocalHost(tuple.host) || tuple.port !== 5432) {
    throw new Error(
      "Local manual keep-list must use localhost:5432. Refusing other targets.",
    );
  }
  if (looksProductionLike(tuple)) {
    throw new Error(
      "Local manual keep-list refused a production-like database target.",
    );
  }
  return tuple;
}

export function assertE2eDatabaseUrl(connectionString: string): ConnectionTuple {
  const tuple = parseConnectionTuple(connectionString);
  if (!isLocalHost(tuple.host) || tuple.port !== 5433) {
    throw new Error(
      "E2E correlation must use localhost:5433. Refusing other targets.",
    );
  }
  if (looksProductionLike(tuple)) {
    throw new Error("E2E correlation refused a production-like database target.");
  }
  return tuple;
}

export function assertProductionOverrideDatabaseUrl(
  connectionString: string,
): ConnectionTuple {
  const tuple = parseConnectionTuple(connectionString);
  if (isLocalHost(tuple.host) && (tuple.port === 5432 || tuple.port === 5433)) {
    throw new Error(
      "Production keep-list override must not target the local manual or E2E database.",
    );
  }
  if (!looksProductionLike(tuple)) {
    throw new Error(
      "Production keep-list override does not look like the documented production database.",
    );
  }
  return tuple;
}

export async function loadLocalManualUsers(
  connectionString = process.env.DATABASE_URL,
): Promise<KeepListLoadResult> {
  const url = connectionString?.trim();
  if (!url) {
    return {
      ok: false,
      code: "LOCAL_MANUAL_KEEP_UNAVAILABLE",
      message: "DATABASE_URL is not set for the local manual database.",
    };
  }
  try {
    assertLocalManualDatabaseUrl(url);
    const users = await queryUsers(url);
    return { ok: true, users, source: "localhost:5432" };
  } catch (error) {
    return {
      ok: false,
      code: "LOCAL_MANUAL_KEEP_UNAVAILABLE",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadE2eUsers(
  connectionString = process.env.E2E_DATABASE_URL,
): Promise<KeepListLoadResult> {
  const url = connectionString?.trim();
  if (!url) {
    return {
      ok: false,
      code: "LOCAL_MANUAL_KEEP_UNAVAILABLE",
      message: "E2E_DATABASE_URL is not set.",
    };
  }
  try {
    assertE2eDatabaseUrl(url);
    const users = await queryUsers(url);
    return { ok: true, users, source: "localhost:5433" };
  } catch (error) {
    return {
      ok: false,
      code: "LOCAL_MANUAL_KEEP_UNAVAILABLE",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function runSsh(host: string, remoteScript: string): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=20",
        "-o",
        "ServerAliveInterval=15",
        host,
        "bash",
        "-s",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.write(remoteScript);
    child.stdin.end();
  });
}

const PRODUCTION_SSH_SCRIPT = `set -euo pipefail
APP_DIR="${PRODUCTION_APP_DIR}"
if [ ! -d "$APP_DIR" ]; then
  echo "PRODUCTION_KEEP_UNAVAILABLE:app_dir" >&2
  exit 2
fi
cd "$APP_DIR"
node <<'NODE'
const fs = require("fs");
const { Client } = require("pg");

function parseEnvFile(path) {
  const parsed = {};
  const text = fs.readFileSync(path, "utf8");
  for (const raw of text.split(/\\r?\\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

const candidates = [
  "/var/www/negotaitions/app/.env.production",
  "/etc/negotaitions/env.production",
];

async function main() {
  let databaseUrl = "";
  for (const path of candidates) {
    try {
      fs.accessSync(path, fs.constants.R_OK);
      const env = parseEnvFile(path);
      if (env.DATABASE_URL && env.DATABASE_URL.trim()) {
        databaseUrl = env.DATABASE_URL.trim();
        break;
      }
    } catch {
      // try next candidate
    }
  }
  if (!databaseUrl) {
    console.error("PRODUCTION_KEEP_UNAVAILABLE:env_unreadable");
    process.exit(2);
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query('SELECT id, email, name FROM "User" ORDER BY id');
    const users = result.rows.map((row) => ({
      id: String(row.id),
      email: row.email ?? null,
      name: row.name ?? null,
    }));
    process.stdout.write(JSON.stringify({ ok: true, users }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("PRODUCTION_KEEP_UNAVAILABLE:query_failed");
  process.exit(3);
});
NODE
`;

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Production SSH output did not contain a JSON object.");
  }
  return JSON.parse(text.slice(start, end + 1));
}

export async function loadProductionUsersViaSsh(
  host = process.env.VOX_ORPHAN_CLEANUP_PRODUCTION_SSH_HOST?.trim() ||
    PRODUCTION_SSH_DEFAULT_HOST,
): Promise<KeepListLoadResult> {
  try {
    const result = await runSsh(host, PRODUCTION_SSH_SCRIPT);
    if (result.code !== 0) {
      return {
        ok: false,
        code: "PRODUCTION_KEEP_UNAVAILABLE",
        message: "Production SSH read-only User query failed.",
      };
    }
    const payload = extractJsonObject(result.stdout) as {
      ok?: boolean;
      users?: AppUserRow[];
    };
    if (!payload.ok || !Array.isArray(payload.users)) {
      return {
        ok: false,
        code: "PRODUCTION_KEEP_UNAVAILABLE",
        message: "Production SSH returned an invalid User inventory.",
      };
    }
    return {
      ok: true,
      users: payload.users.map((user) => ({
        id: String(user.id),
        email: user.email ?? null,
        name: user.name ?? null,
      })),
      source: `ssh:${host}`,
    };
  } catch {
    return {
      ok: false,
      code: "PRODUCTION_KEEP_UNAVAILABLE",
      message: "Production SSH read-only access is unavailable.",
    };
  }
}

export async function loadProductionUsers(): Promise<KeepListLoadResult> {
  const override = process.env.VOX_ORPHAN_CLEANUP_PRODUCTION_DATABASE_URL?.trim();
  if (override) {
    try {
      assertProductionOverrideDatabaseUrl(override);
      const users = await queryUsers(override);
      return {
        ok: true,
        users,
        source: "production-database-url-override",
      };
    } catch (error) {
      return {
        ok: false,
        code: "PRODUCTION_KEEP_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return loadProductionUsersViaSsh();
}

export async function loadRemoteVoxUsers(): Promise<RemoteInventoryLoadResult> {
  try {
    const config = getVoximplantConfig({ requireForRuntime: true });
    const applicationName = config.applicationName;
    const users = await listRemoteVoximplantUsers(applicationName);
    return {
      ok: true,
      applicationName,
      users: users.map(
        (user): RemoteVoxUser => ({
          userId: user.userId,
          userName: user.userName,
          userDisplayName: user.userDisplayName,
          applicationId: user.applicationId,
          applicationName: user.applicationName ?? applicationName,
          createdAt: user.createdAt,
          modifiedAt: user.modifiedAt,
        }),
      ),
    };
  } catch (error) {
    return {
      ok: false,
      code: "REMOTE_INVENTORY_UNAVAILABLE",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function deleteClassifiedRemoteUser(
  candidate: DeleteCandidate,
): Promise<void> {
  await deleteRemoteVoximplantUser({
    remoteUserId: candidate.userId,
    providerUsername: candidate.userName,
  });
}

export function createLiveOrphanCleanupLoaders(): OrphanCleanupLoaders {
  return {
    loadProductionUsers,
    loadLocalManualUsers,
    loadE2eUsers,
    loadRemoteUsers: loadRemoteVoxUsers,
    loadExplicitUsernames: () => collectExplicitPocUsernames(),
  };
}
