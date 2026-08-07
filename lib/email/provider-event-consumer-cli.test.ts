import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  EXIT_AUTHENTICATION,
  EXIT_INVALID_CONFIG,
  EXIT_OK,
  EXIT_RETRYABLE,
  exitCodeForConsumerFailure,
  runProviderEventConsumerCli,
  type ProviderEventConsumerCliDeps,
} from "@/lib/email/provider-event-consumer-cli";
import {
  ProviderEventConsumerError,
  type ProviderEventConsumerCounters,
} from "@/lib/email/provider-event-consumer";
import { baseProviderEventConfig } from "@/lib/email/provider-event-consumer-harness";

const emptyCounters: ProviderEventConsumerCounters = {
  recordsRead: 0,
  processed: 0,
  duplicates: 0,
  ignored: 0,
  ingestionFailures: 0,
  checkpointsAdvanced: 0,
  transientRetries: 0,
  shardsDiscovered: 0,
  shardsRetired: 0,
  iteratorReacquisitions: 0,
  rounds: 0,
  lagMillis: null,
};

type LoggedEvent = { level: string; event: string; data: Record<string, unknown> };

function harness(
  overrides: Partial<ProviderEventConsumerCliDeps>,
): { deps: ProviderEventConsumerCliDeps; events: LoggedEvent[]; fire: (signal: string) => void } {
  const events: LoggedEvent[] = [];
  let handler: ((signalName: string) => void) | null = null;

  const deps: ProviderEventConsumerCliDeps = {
    loadConfig: () => ({ ...baseProviderEventConfig }),
    run: async () => emptyCounters,
    log: (level, event, data) => events.push({ level, event, data }),
    onShutdownSignal: (registered) => {
      handler = registered;
    },
    ...overrides,
  };

  return {
    deps,
    events,
    fire: (signal) => handler?.(signal),
  };
}

test("normal completion exits zero", async () => {
  const { deps, events } = harness({});
  assert.equal(await runProviderEventConsumerCli(deps, { once: true }), EXIT_OK);
  assert.ok(events.some((entry) => entry.event === "consumer_completed"));
});

test("disabled ingestion exits zero with a clear consumer_disabled event", async () => {
  let ran = false;
  const { deps, events } = harness({
    loadConfig: () => ({ ...baseProviderEventConfig, enabled: false }),
    run: async () => {
      ran = true;
      return emptyCounters;
    },
  });

  assert.equal(await runProviderEventConsumerCli(deps), EXIT_OK);
  assert.equal(ran, false);
  assert.ok(events.some((entry) => entry.event === "consumer_disabled"));
  assert.equal(events.some((entry) => entry.event === "consumer_failed"), false);
});

test("SIGTERM during a poll produces a controlled zero-exit shutdown", async () => {
  const { deps, events, fire } = harness({
    run: async ({ signal }) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return emptyCounters;
    },
  });

  const running = runProviderEventConsumerCli(deps);
  setTimeout(() => fire("SIGTERM"), 5).unref?.();

  assert.equal(await running, EXIT_OK);
  assert.ok(events.some((entry) => entry.event === "shutdown_requested"));
  assert.equal(events.some((entry) => entry.event === "consumer_failed"), false);
});

test("an AbortError from the consumer is not reported as consumer_failed", async () => {
  const abort = new Error("Aborted");
  abort.name = "AbortError";
  const { deps, events, fire } = harness({
    run: async () => {
      throw abort;
    },
  });

  const running = runProviderEventConsumerCli(deps);
  fire("SIGINT");
  assert.equal(await running, EXIT_OK);
  assert.equal(events.some((entry) => entry.event === "consumer_failed"), false);
  assert.ok(events.some((entry) => entry.event === "consumer_stopped"));
});

test("a shutdown that exceeds the configured budget exits through the retryable path", async () => {
  const { deps, events, fire } = harness({
    shutdownTimeoutMsOverride: 20,
    run: () => new Promise<ProviderEventConsumerCounters>(() => {}),
  });

  const running = runProviderEventConsumerCli(deps);
  setTimeout(() => fire("SIGTERM"), 5).unref?.();

  assert.equal(await running, EXIT_RETRYABLE);
  const timeout = events.find((entry) => entry.event === "shutdown_timeout");
  assert.ok(timeout);
  assert.equal(timeout?.data.shutdownTimeoutMs, 20);
});

test("invalid configuration exits with the terminal non-restarting code", async () => {
  const { deps, events } = harness({
    loadConfig: () => {
      throw new Error("Invalid EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS.");
    },
  });
  assert.equal(await runProviderEventConsumerCli(deps), EXIT_INVALID_CONFIG);
  assert.ok(events.some((entry) => entry.event === "consumer_invalid_config"));
});

test("terminal authentication failure exits with the terminal non-restarting code", async () => {
  const { deps, events } = harness({
    run: async () => {
      throw new ProviderEventConsumerError(
        "STREAM_AUTH_FAILURE",
        "auth failed",
        "authentication",
      );
    },
  });

  assert.equal(await runProviderEventConsumerCli(deps), EXIT_AUTHENTICATION);
  const failure = events.find((entry) => entry.event === "consumer_failed");
  assert.equal(failure?.data.restartable, false);
  assert.equal(failure?.data.code, "STREAM_AUTH_FAILURE");
});

test("transient runtime failure exits with the retryable code", async () => {
  const { deps, events } = harness({
    run: async () => {
      throw new ProviderEventConsumerError(
        "STREAM_RETRY_EXHAUSTED",
        "exhausted",
        "retryable",
      );
    },
  });

  assert.equal(await runProviderEventConsumerCli(deps), EXIT_RETRYABLE);
  assert.equal(
    events.find((entry) => entry.event === "consumer_failed")?.data.restartable,
    true,
  );
});

test("consumer failure logs never contain free-form exception text", async () => {
  const hostile = new Error("recipient victim@example.com token sk-secret-value");
  hostile.name = "PrismaClientValidationError";
  const { deps, events } = harness({
    run: async () => {
      throw hostile;
    },
  });

  await runProviderEventConsumerCli(deps);
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /victim@example\.com/);
  assert.doesNotMatch(serialized, /sk-secret-value/);
});

test("exit-code mapping is exhaustive over consumer failure kinds", () => {
  assert.equal(
    exitCodeForConsumerFailure(
      new ProviderEventConsumerError("X", "x", "invalid_config"),
    ),
    EXIT_INVALID_CONFIG,
  );
  assert.equal(
    exitCodeForConsumerFailure(
      new ProviderEventConsumerError("X", "x", "authentication"),
    ),
    EXIT_AUTHENTICATION,
  );
  assert.equal(
    exitCodeForConsumerFailure(
      new ProviderEventConsumerError("X", "x", "lock_contention"),
    ),
    EXIT_RETRYABLE,
  );
  assert.equal(exitCodeForConsumerFailure(new Error("unknown")), EXIT_RETRYABLE);
});

// ---------------------------------------------------------------------------
// F-07 systemd restart semantics
// ---------------------------------------------------------------------------

test("the consumer unit bounds restarts and never retries terminal exit codes", () => {
  const unit = readFileSync(
    path.join(
      process.cwd(),
      "deploy/systemd/negotiations-email-provider-events.service",
    ),
    "utf8",
  );

  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^RestartSec=10s$/m);
  assert.match(unit, /^RestartPreventExitStatus=78 77$/m);
  assert.match(unit, /^StartLimitIntervalSec=300$/m);
  assert.match(unit, /^StartLimitBurst=5$/m);
  assert.match(unit, /^TimeoutStopSec=30s$/m);
  assert.equal(/^ReadWritePaths=\/var\/www\/negotaitions\/app$/m.test(unit), false);
  assert.match(unit, /^KillSignal=SIGTERM$/m);

  // Existing hardening must be retained.
  for (const directive of [
    "NoNewPrivileges=true",
    "ProtectSystem=strict",
    "ProtectHome=true",
    "PrivateTmp=true",
  ]) {
    assert.match(unit, new RegExp(`^${directive}$`, "m"), `missing ${directive}`);
  }

  // Persistable by explicit operator action after controlled validation.
  assert.match(unit, /^WantedBy=multi-user\.target$/m);

  // TimeoutStopSec must exceed the default application shutdown budget.
  const timeoutStopSec = Number(/^TimeoutStopSec=(\d+)s$/m.exec(unit)?.[1]);
  assert.ok(timeoutStopSec * 1000 > baseProviderEventConfig.shutdownTimeoutMs);
  assert.ok(timeoutStopSec * 1000 >= 30_000);
});

test("provider-event reconciliation timer is persistable but service is not directly enabled", () => {
  const service = readFileSync(
    path.join(
      process.cwd(),
      "deploy/systemd/negotiations-email-provider-event-reconciliation.service",
    ),
    "utf8",
  );
  const timer = readFileSync(
    path.join(
      process.cwd(),
      "deploy/systemd/negotiations-email-provider-event-reconciliation.timer",
    ),
    "utf8",
  );

  assert.match(timer, /^WantedBy=timers\.target$/m);
  assert.equal(/^WantedBy=/m.test(service), false);
  assert.match(service, /^Type=oneshot$/m);
  assert.match(timer, /^Unit=negotiations-email-provider-event-reconciliation\.service$/m);
});

test("provider-event units cannot write to the application tree", () => {
  for (const file of [
    "deploy/systemd/negotiations-email-provider-events.service",
    "deploy/systemd/negotiations-email-provider-event-reconciliation.service",
  ]) {
    const unit = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.equal(
      /^ReadWritePaths=\/var\/www\/negotaitions\/app$/m.test(unit),
      false,
      `${file} grants application-tree write access`,
    );
    assert.match(unit, /^ProtectSystem=strict$/m);
    assert.match(unit, /^ProtectHome=true$/m);
    assert.match(unit, /^PrivateTmp=true$/m);
    assert.match(unit, /^NoNewPrivileges=true$/m);
  }
});
