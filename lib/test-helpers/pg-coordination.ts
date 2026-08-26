import pg from "pg";

export const PG_TEST_CONNECTION_TIMEOUT_MS = 5_000;
export const PG_TEST_STATEMENT_TIMEOUT_MS = 10_000;
export const PG_TEST_LOCK_TIMEOUT_SAFETY_MS = 20_000;
export const PG_TEST_COORDINATION_TIMEOUT_MS = 15_000;

export const PG_TEST_SETUP_STATEMENT_TIMEOUT_SQL = `SET statement_timeout = '${PG_TEST_STATEMENT_TIMEOUT_MS}ms'`;
export const PG_TEST_LOCK_TIMEOUT_SAFETY_SQL = `SET lock_timeout = '${PG_TEST_LOCK_TIMEOUT_SAFETY_MS}ms'`;

export type CoordinationSignal = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
  isSettled: () => boolean;
};

export type CoordinationBarrier = {
  arrived: Promise<void>;
  wait: () => Promise<void>;
  release: () => void;
  reject: (reason?: unknown) => void;
};

type EndableResource = {
  end?: () => unknown;
  $disconnect?: () => unknown;
};

function toError(reason: unknown, fallback: string): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(fallback);
}

export function createCoordinationSignal(options?: {
  timeoutMs?: number;
  label?: string;
}): CoordinationSignal {
  const timeoutMs = options?.timeoutMs ?? PG_TEST_COORDINATION_TIMEOUT_MS;
  const label = options?.label ? `: ${options.label}` : "";
  let settled = false;
  let resolvePromise!: () => void;
  let rejectPromise!: (reason?: unknown) => void;

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const finish = (action: () => void) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    action();
  };

  const timer = setTimeout(() => {
    finish(() => {
      rejectPromise(
        new Error(`Coordination signal timed out after ${timeoutMs}ms${label}`),
      );
    });
  }, timeoutMs);
  timer.unref?.();

  return {
    promise,
    resolve: () => finish(() => resolvePromise()),
    reject: (reason) =>
      finish(() =>
        rejectPromise(
          toError(reason, `Coordination signal rejected${label}`),
        ),
      ),
    isSettled: () => settled,
  };
}

export function createCoordinationBarrier(options?: {
  timeoutMs?: number;
  label?: string;
}): CoordinationBarrier {
  const prefix = options?.label ?? "barrier";
  const arrived = createCoordinationSignal({
    timeoutMs: options?.timeoutMs,
    label: `${prefix}:arrived`,
  });
  const release = createCoordinationSignal({
    timeoutMs: options?.timeoutMs,
    label: `${prefix}:release`,
  });
  return {
    arrived: arrived.promise,
    wait: async () => {
      arrived.resolve();
      await release.promise;
    },
    release: () => release.resolve(),
    reject: (reason) => {
      arrived.reject(reason);
      release.reject(reason);
    },
  };
}

/**
 * Wait for the expected coordination signal, or fail immediately if the
 * upstream mutation/finalization can no longer produce that signal.
 * An upstream success without the signal stays pending until resolve/timeout.
 */
export async function awaitSignalOrFailure(
  signal: Promise<unknown>,
  upstream: Promise<unknown>,
): Promise<void> {
  let upstreamError: unknown;
  const upstreamFailure = upstream.then(
    () => new Promise<void>(() => {}),
    (error: unknown) => {
      upstreamError = error;
      throw error;
    },
  );
  try {
    await Promise.race([signal, upstreamFailure]);
  } catch (error) {
    throw upstreamError ?? error;
  }
}

export function createPgTestClient(connectionString: string): pg.Client {
  return new pg.Client({
    connectionString,
    connectionTimeoutMillis: PG_TEST_CONNECTION_TIMEOUT_MS,
  });
}

export function createPgTestPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: PG_TEST_CONNECTION_TIMEOUT_MS,
  });
}

export async function applyPgSetupSessionGuards(client: pg.Client): Promise<void> {
  await client.query(PG_TEST_SETUP_STATEMENT_TIMEOUT_SQL);
}

export async function applyPgLockingSessionSafety(client: pg.Client): Promise<void> {
  await client.query(PG_TEST_LOCK_TIMEOUT_SAFETY_SQL);
}

export async function endPgTestResources(
  resources: Array<EndableResource | null | undefined>,
): Promise<void> {
  await Promise.allSettled(
    resources.map((resource) => {
      if (!resource) {
        return Promise.resolve();
      }
      if (typeof resource.$disconnect === "function") {
        return Promise.resolve(resource.$disconnect());
      }
      if (typeof resource.end === "function") {
        return Promise.resolve(resource.end());
      }
      return Promise.resolve();
    }),
  );
}
