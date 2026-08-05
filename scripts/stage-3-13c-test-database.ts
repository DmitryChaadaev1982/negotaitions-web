export const STAGE313C_TEST_DATABASE_URL_ENV =
  "STAGE313C_TEST_DATABASE_URL";
export const STAGE313C_TEST_DATABASE_APPROVED_ENV =
  "STAGE313C_TEST_DATABASE_APPROVED";
export const STAGE313C_TEST_SCHEMA_ENV = "STAGE313C_TEST_SCHEMA";
export const STAGE313C_TEST_SCHEMA = "stage3_13c_final_remediation";
export const STAGE313C_TEST_SCHEMA_MARKER =
  "NegotAItions Stage 3.13C verifier-owned schema";
export const STAGE313C_VERIFIER_APPLICATION_NAME = "stage313c_verifier";
export const STAGE313C_COORDINATOR_APPLICATION_NAME =
  "stage313c_verifier_coordinator";

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);
const TEST_DATABASE_MARKER =
  /(?:^|[_-])(?:stage[_-]?3[_-]?13c|test(?:ing)?|e2e)(?:$|[_-])/i;
const PRODUCTION_MARKER =
  /(?:^|[_-])(?:prod|production|main|primary|master)(?:$|[_-])|negotaitions_prod|negotiations_prod/i;
const UNSUPPORTED_SCOPE_PARAMETERS = new Set([
  "schema",
  "search_path",
  "currentschema",
  "options",
]);

export type Stage313cTestDatabaseRefusalCode =
  | "TEST_DATABASE_URL_MISSING"
  | "TEST_DATABASE_URL_INVALID"
  | "TEST_DATABASE_NOT_POSTGRESQL"
  | "TEST_DATABASE_NOT_LOCAL"
  | "TEST_DATABASE_NAME_INVALID"
  | "TEST_DATABASE_NAME_NOT_TEST_LIKE"
  | "TEST_DATABASE_PRODUCTION_LIKE"
  | "TEST_DATABASE_SCHEMA_OVERRIDE_REFUSED"
  | "TEST_DATABASE_APPROVAL_REQUIRED"
  | "TEST_DATABASE_SCHEMA_REFUSED"
  | "TEST_DATABASE_CHILD_SCOPE_MISSING"
  | "TEST_DATABASE_CHILD_SCOPE_MISMATCH";

export class Stage313cTestDatabaseRefusal extends Error {
  constructor(public readonly code: Stage313cTestDatabaseRefusalCode) {
    super(code);
    this.name = "Stage313cTestDatabaseRefusal";
  }
}

export type ApprovedStage313cTestDatabase = {
  baseDatabaseUrl: string;
  databaseName: string;
  schemaName: typeof STAGE313C_TEST_SCHEMA;
};

function refuse(code: Stage313cTestDatabaseRefusalCode): never {
  throw new Stage313cTestDatabaseRefusal(code);
}

export function resolveApprovedStage313cTestDatabase(
  env: NodeJS.ProcessEnv,
): ApprovedStage313cTestDatabase {
  if (env[STAGE313C_TEST_DATABASE_APPROVED_ENV]?.trim() !== "true") {
    refuse("TEST_DATABASE_APPROVAL_REQUIRED");
  }
  if (env[STAGE313C_TEST_SCHEMA_ENV]?.trim() !== STAGE313C_TEST_SCHEMA) {
    refuse("TEST_DATABASE_SCHEMA_REFUSED");
  }

  const raw = env[STAGE313C_TEST_DATABASE_URL_ENV]?.trim();
  if (!raw) refuse("TEST_DATABASE_URL_MISSING");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    refuse("TEST_DATABASE_URL_INVALID");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    refuse("TEST_DATABASE_NOT_POSTGRESQL");
  }
  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    refuse("TEST_DATABASE_NOT_LOCAL");
  }
  if (url.hash) refuse("TEST_DATABASE_URL_INVALID");

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    refuse("TEST_DATABASE_NAME_INVALID");
  }
  if (!databaseName || databaseName.includes("/")) {
    refuse("TEST_DATABASE_NAME_INVALID");
  }
  if (PRODUCTION_MARKER.test(databaseName)) {
    refuse("TEST_DATABASE_PRODUCTION_LIKE");
  }
  if (!TEST_DATABASE_MARKER.test(databaseName)) {
    refuse("TEST_DATABASE_NAME_NOT_TEST_LIKE");
  }

  for (const key of url.searchParams.keys()) {
    if (UNSUPPORTED_SCOPE_PARAMETERS.has(key.toLowerCase())) {
      refuse("TEST_DATABASE_SCHEMA_OVERRIDE_REFUSED");
    }
  }

  return {
    baseDatabaseUrl: raw,
    databaseName,
    schemaName: STAGE313C_TEST_SCHEMA,
  };
}

export function deriveStage313cSchemaScopedDatabaseUrl(
  approved: ApprovedStage313cTestDatabase,
): string {
  const url = new URL(approved.baseDatabaseUrl);
  url.searchParams.set("schema", approved.schemaName);
  url.searchParams.set(
    "options",
    `-c search_path=${approved.schemaName}`,
  );
  url.searchParams.set(
    "application_name",
    STAGE313C_VERIFIER_APPLICATION_NAME,
  );
  return url.toString();
}

export function assertApprovedStage313cVerifierChildEnvironment(
  env: NodeJS.ProcessEnv,
): ApprovedStage313cTestDatabase & { scopedDatabaseUrl: string } {
  const approved = resolveApprovedStage313cTestDatabase(env);
  const actual = env.DATABASE_URL?.trim();
  if (!actual) refuse("TEST_DATABASE_CHILD_SCOPE_MISSING");

  let actualCanonical: string;
  try {
    actualCanonical = new URL(actual).toString();
  } catch {
    refuse("TEST_DATABASE_CHILD_SCOPE_MISMATCH");
  }
  const expected = deriveStage313cSchemaScopedDatabaseUrl(approved);
  if (actualCanonical !== expected) {
    refuse("TEST_DATABASE_CHILD_SCOPE_MISMATCH");
  }
  return { ...approved, scopedDatabaseUrl: expected };
}
