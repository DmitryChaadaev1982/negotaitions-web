import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { getEmailConfig } from "@/lib/email/config";
import {
  bootstrapOperationalEnv,
  shouldLoadLocalOperationalEnv,
} from "@/lib/operational-env";

const ENV_KEYS = [
  "NODE_ENV",
  "EMAIL_DELIVERY_ENABLED",
  "EMAIL_PROVIDER",
  "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
  "EMAIL_CANONICAL_BASE_URL",
  "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
  "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
  "YANDEX_DATA_STREAMS_ENDPOINT",
  "YANDEX_DATA_STREAMS_STREAM_NAME",
] as const;

function withEnv<T>(updates: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) previous.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production operational bootstrap skips app env loading", () => {
  let calls = 0;
  const result = bootstrapOperationalEnv({
    nodeEnv: "production",
    projectDir: "/repo",
    loadEnvConfig: () => {
      calls += 1;
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.loaded, false);
  assert.equal(shouldLoadLocalOperationalEnv("production"), false);
});

test("non-production operational bootstrap retains local env loading", () => {
  let loadedProjectDir: string | null = null;
  const result = bootstrapOperationalEnv({
    nodeEnv: "development",
    projectDir: "/repo",
    loadEnvConfig: (projectDir) => {
      loadedProjectDir = projectDir;
    },
  });

  assert.equal(result.loaded, true);
  assert.equal(loadedProjectDir, "/repo");
  assert.equal(shouldLoadLocalOperationalEnv("test"), true);
});

test("missing production provider-event env fails validation instead of loading app env", () => {
  withEnv(
    {
      NODE_ENV: "production",
      EMAIL_DELIVERY_ENABLED: "false",
      EMAIL_PROVIDER: "disabled",
      EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: "true",
      EMAIL_CANONICAL_BASE_URL: "https://negotaitions.ru",
      YANDEX_DATA_STREAMS_ACCESS_KEY_ID: undefined,
      YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY: undefined,
      YANDEX_DATA_STREAMS_ENDPOINT: undefined,
      YANDEX_DATA_STREAMS_STREAM_NAME: undefined,
    },
    () => {
      bootstrapOperationalEnv({
        loadEnvConfig: () => {
          process.env.YANDEX_DATA_STREAMS_ACCESS_KEY_ID = "would-have-loaded";
          process.env.YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY = "would-have-loaded";
        },
      });

      assert.throws(
        () => getEmailConfig(),
        /Missing Yandex Data Streams credentials for enabled provider-event ingestion\./,
      );
    },
  );
});

test("systemd production ops units inject approved production environment", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  const systemdDir = path.join(process.cwd(), "deploy/systemd");
  const checkedUnits = new Set<string>();

  for (const unitName of readdirSync(systemdDir)) {
    if (!unitName.endsWith(".service")) continue;
    const unit = readFileSync(path.join(systemdDir, unitName), "utf8");
    if (!/^User=www-data$/m.test(unit)) continue;
    if (!/^Environment=NODE_ENV=production$/m.test(unit)) continue;

    const scriptName = /^ExecStart=\/usr\/bin\/npm run ([\w:.-]+)/m.exec(unit)?.[1];
    if (!scriptName) continue;
    const script = packageJson.scripts[scriptName];
    if (!script?.includes("scripts/ops/")) continue;

    checkedUnits.add(unitName);
    assert.match(
      unit,
      /^EnvironmentFile=\/etc\/negotaitions\/env\.production$/m,
      `${unitName} must inject production env through systemd`,
    );
  }

  assert.ok(
    checkedUnits.has("negotiations-stage310-maintenance.service"),
    "Stage 3.10 maintenance service should be covered by the generic systemd check",
  );
  assert.ok(
    checkedUnits.has("negotiations-email-provider-events.service"),
    "provider-event consumer service should be covered by the generic systemd check",
  );
});

test("activation runbook normalizes permissions before worker starts", () => {
  const runbook = readFileSync(
    path.join(process.cwd(), "docs/operations/email-yandex-activation-runbook.md"),
    "utf8",
  );
  const applyIndex = runbook.indexOf("npm run ops:runtime-permissions:apply");
  const checkIndex = runbook.indexOf("npm run ops:runtime-permissions:check");
  const backlogIndex = runbook.indexOf("negotiations-email-backlog-quarantine.service");
  const providerStartIndex = runbook.indexOf(
    "sudo systemctl start negotiations-email-provider-events.service",
  );
  const canaryIndex = runbook.indexOf("negotiations-email-canary@<EmailMessage-ID>.service");
  const workerTimerIndex = runbook.indexOf("Only then enable the normal worker timer");

  assert.ok(applyIndex > 0, "runtime permission apply command is documented");
  assert.ok(checkIndex > applyIndex, "runtime permission check follows apply");
  for (const [label, index] of [
    ["backlog quarantine", backlogIndex],
    ["provider-event consumer", providerStartIndex],
    ["delivery canary", canaryIndex],
    ["normal worker timer", workerTimerIndex],
  ] as const) {
    assert.ok(index > checkIndex, `${label} must start only after normalization`);
  }
  assert.equal(runbook.includes("Do not enable in Stage 3.13C"), false);
});

test("provider-event rollback disables persistent timer before consumer", () => {
  const runbook = readFileSync(
    path.join(process.cwd(), "docs/operations/email-yandex-activation-runbook.md"),
    "utf8",
  );
  const rollback = runbook.slice(runbook.indexOf("## Rollback"));
  const timerDisable = rollback.indexOf(
    "sudo systemctl disable --now negotiations-email-provider-event-reconciliation.timer",
  );
  const consumerDisable = rollback.indexOf(
    "sudo systemctl disable --now negotiations-email-provider-events.service",
  );
  const ingestionFlag = rollback.indexOf("EMAIL_PROVIDER_EVENT_INGESTION_ENABLED=false");

  assert.ok(timerDisable >= 0, "rollback disables reconciliation timer");
  assert.ok(consumerDisable > timerDisable, "rollback disables consumer after timer");
  assert.ok(ingestionFlag > consumerDisable, "ingestion flag is disabled after units");
});

test("Stage 3.10 maintenance runbook normalizes before systemd start", () => {
  const runbook = readFileSync(
    path.join(process.cwd(), "docs/operations/stage-3-10-maintenance-runbook.md"),
    "utf8",
  );
  const applyIndex = runbook.indexOf("npm run ops:runtime-permissions:apply");
  const checkIndex = runbook.indexOf("npm run ops:runtime-permissions:check");
  const startIndex = runbook.indexOf(
    "sudo systemctl start negotiations-stage310-maintenance.service",
  );

  assert.ok(applyIndex > 0, "maintenance runbook includes apply");
  assert.ok(checkIndex > applyIndex, "maintenance runbook checks after apply");
  assert.ok(startIndex > checkIndex, "maintenance service starts after normalization");
});

test("legacy deployment and rollback sequences normalize before runtime restart", () => {
  const releasePlan = readFileSync(
    path.join(process.cwd(), "docs/releases/stage-3-10-release-plan.md"),
    "utf8",
  );
  const releaseApply = releasePlan.indexOf("npm run ops:runtime-permissions:apply");
  const releaseCheck = releasePlan.indexOf("npm run ops:runtime-permissions:check");
  const releaseRestart = releasePlan.indexOf("Restart app service (`negotaitions-poc`)");
  assert.ok(releaseApply > releasePlan.indexOf("Stage/pull release code"));
  assert.ok(releaseCheck > releaseApply);
  assert.ok(releaseRestart > releaseCheck);

  const rollbackPlan = readFileSync(
    path.join(process.cwd(), "docs/releases/stage-3-10-rollback-plan.md"),
    "utf8",
  );
  const rollbackApply = rollbackPlan.indexOf("npm run ops:runtime-permissions:apply");
  const rollbackCheck = rollbackPlan.indexOf("npm run ops:runtime-permissions:check");
  const rollbackRestart = rollbackPlan.indexOf("Restart `negotaitions-poc`");
  assert.ok(rollbackApply > rollbackPlan.indexOf("Restore prior application"));
  assert.ok(rollbackCheck > rollbackApply);
  assert.ok(rollbackRestart > rollbackCheck);
  assert.equal(rollbackPlan.includes("chmod -R"), true);
  assert.match(rollbackPlan, /do not substitute\s+`chmod -R`/);
});

test("Voximplant deployment runtime starts only after normalization", () => {
  const runbook = readFileSync(
    path.join(process.cwd(), "docs/voximplant/yandex-deployment-runbook.md"),
    "utf8",
  );
  const buildSection = runbook.slice(
    runbook.indexOf("## 2) Build and runtime commands"),
    runbook.indexOf("## 3) Database migration commands"),
  );
  const applyIndex = buildSection.indexOf("npm run ops:runtime-permissions:apply");
  const checkIndex = buildSection.indexOf("npm run ops:runtime-permissions:check");
  const startIndex = buildSection.indexOf("npm run start");
  assert.ok(applyIndex > buildSection.indexOf("npx prisma generate"));
  assert.ok(checkIndex > applyIndex);
  assert.ok(startIndex > checkIndex);
});

test("historical Stage 3.10 rollback blocks fail closed before restart", () => {
  const plan = readFileSync(
    path.join(
      process.cwd(),
      "docs/audits/stage-3-10-production-debrief-hotfix/production-canary-plan.md",
    ),
    "utf8",
  );
  const rollback = plan.slice(
    plan.indexOf("```bash", plan.indexOf("## Rollback")),
    plan.indexOf("### Recovery back"),
  );
  const recovery = plan.slice(plan.indexOf("```bash", plan.indexOf("### Recovery back")));

  for (const [label, block] of [
    ["rollback", rollback],
    ["recovery", recovery],
  ] as const) {
    const applyIndex = block.indexOf("npm run ops:runtime-permissions:apply");
    const checkIndex = block.indexOf("npm run ops:runtime-permissions:check");
    const restartIndex = block.indexOf("sudo systemctl restart negotaitions-poc");
    assert.ok(applyIndex > block.indexOf("npm run build"), `${label} applies after build`);
    assert.ok(checkIndex > applyIndex, `${label} checks after apply`);
    assert.ok(restartIndex > checkIndex, `${label} restarts after normalization`);
  }
});

test("provider-event unit distinguishes manual canary start from enablement", () => {
  const unit = readFileSync(
    path.join(
      process.cwd(),
      "deploy/systemd/negotiations-email-provider-events.service",
    ),
    "utf8",
  );
  assert.match(unit, /Installed disabled\. Start manually for the controlled canary/);
  assert.match(unit, /enable only\s+# after canary validation and explicit production approval/);
  assert.equal(
    unit.includes("Enable only during a controlled provider-event canary"),
    false,
  );
});
