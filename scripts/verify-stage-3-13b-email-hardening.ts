import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import {
  EmailDeliveryAttemptStatus,
  EmailMessageCategory,
  EmailMessageStatus,
  EmailMessageType,
  EmailProviderEventProcessingStatus,
  EmailProviderEventType,
  EmailSuppressionReason,
  EmailSuppressionSource,
} from "@/app/generated/prisma/client";
import { normalizeEmailAddress } from "@/lib/email/address";
import { enqueueEmail } from "@/lib/email/outbox";
import { FakeEmailProvider } from "@/lib/email/provider";
import {
  processEmailProviderEvent,
  runEmailProviderEventReconciliationSweep,
} from "@/lib/email/provider-events";
import { runEmailRetentionCleanup } from "@/lib/email/retention";
import { createActiveSuppression } from "@/lib/email/suppression";
import type {
  EmailProvider,
  EmailProviderSendInput,
  EmailProviderSendResult,
} from "@/lib/email/types";
import { runEmailDeliverySweep } from "@/lib/email/worker";
import { prisma } from "@/lib/prisma";

type Step = { name: string; pass: true; detail: string };

const runId = Math.random().toString(36).slice(2, 10);
const steps: Step[] = [];

function record(name: string, detail: string) {
  steps.push({ name, pass: true, detail });
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function setDeliveryEnv(enabled: boolean, provider = "fake") {
  process.env.EMAIL_DELIVERY_ENABLED = enabled ? "true" : "false";
  process.env.EMAIL_PROVIDER = provider;
  process.env.EMAIL_ADMIN_TEST_ENABLED = "true";
}

function recipient(label: string) {
  return `stage313b-${label}-${runId}@example.invalid`;
}

function variables(label: string) {
  return {
    adminName: "Stage313B Admin",
    generatedAt: new Date().toISOString(),
    canonicalBaseUrl: "https://negotaitions.ru",
    supportEmail: "support@example.invalid",
    operatorName: "Stage313B Operator",
    reason: label,
  };
}

async function enqueueSystemTest(label: string) {
  return enqueueEmail({
    messageType: EmailMessageType.SYSTEM_TEST,
    category: EmailMessageCategory.ADMIN_TEST,
    recipientEmail: recipient(label),
    locale: "en",
    templateKey: "system-test",
    variables: variables(label),
    idempotencyKey: `stage313b:${runId}:${label}`,
    metadata: { source: "stage313b_verify", label },
  });
}

async function cancelMessage(messageId: string) {
  await prisma.emailMessage.update({
    where: { id: messageId },
    data: {
      status: EmailMessageStatus.CANCELLED,
      claimToken: null,
      claimedAt: null,
      claimExpiresAt: null,
      processingAt: null,
      nextAttemptAt: null,
      cancelledAt: new Date(),
    },
  });
}

class UnknownOutcomeProvider implements EmailProvider {
  readonly name = "fake";
  readonly transport = "memory";
  sent = 0;

  async send(): Promise<EmailProviderSendResult> {
    this.sent += 1;
    return {
      ok: false,
      providerName: this.name,
      transport: this.transport,
      retryable: true,
      acceptanceUnknown: true,
      errorCode: "PROVIDER_ACCEPTANCE_UNKNOWN",
      sanitizedMessage: "Provider request outcome is unknown after dispatch.",
    };
  }
}

class StaleClaimProvider implements EmailProvider {
  readonly name = "fake";
  readonly transport = "memory";
  sent = 0;

  async send(input: EmailProviderSendInput): Promise<EmailProviderSendResult> {
    this.sent += 1;
    await prisma.emailMessage.update({
      where: { id: input.id },
      data: {
        claimToken: `new-owner-${runId}`,
        claimExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    return {
      ok: true,
      providerName: this.name,
      transport: this.transport,
      providerMessageId: `stale-${runId}`,
      acceptedAt: new Date(),
    };
  }
}

async function main() {
  setDeliveryEnv(true);

  const ordinary = await enqueueSystemTest("ordinary");
  const ordinaryDuplicate = await enqueueSystemTest("ordinary");
  assertCondition(ordinary.created && !ordinary.duplicate && !ordinary.suppressed, "ordinary enqueue semantics failed");
  assertCondition(!ordinaryDuplicate.created && ordinaryDuplicate.duplicate && !ordinaryDuplicate.suppressed, "ordinary duplicate semantics failed");
  record("enqueue ordinary and duplicate", "created=true duplicate=false; duplicate returns created=false duplicate=true");
  await cancelMessage(ordinary.messageId);

  await createActiveSuppression({
    recipientEmailNormalized: normalizeEmailAddress(recipient("suppressed")),
    reason: EmailSuppressionReason.MANUAL,
    source: EmailSuppressionSource.SYSTEM,
  });
  const suppressed = await enqueueSystemTest("suppressed");
  const suppressedDuplicate = await enqueueSystemTest("suppressed");
  assertCondition(suppressed.created && !suppressed.duplicate && suppressed.suppressed, "new suppressed semantics failed");
  assertCondition(!suppressedDuplicate.created && suppressedDuplicate.duplicate && suppressedDuplicate.suppressed, "duplicate suppressed semantics failed");
  record("enqueue suppressed semantics", "new suppressed and duplicate suppressed return corrected flags");

  setDeliveryEnv(false, "disabled");
  const disabled = await enqueueSystemTest("disabled");
  const disabledSweep = await runEmailDeliverySweep({ limit: 5 });
  const disabledMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: disabled.messageId } });
  assertCondition(disabledSweep.deliveryDisabled && disabledMessage.status === EmailMessageStatus.PENDING, "disabled sweep mutated message");
  record("delivery disabled sweep", "delivery disabled returned without provider call or state mutation");
  await cancelMessage(disabled.messageId);

  setDeliveryEnv(true, "fake");
  const fake = await enqueueSystemTest("fake");
  const fakeProvider = new FakeEmailProvider();
  const fakeSweep = await runEmailDeliverySweep({ provider: fakeProvider, limit: 1 });
  const fakeMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: fake.messageId } });
  assertCondition(fakeSweep.accepted === 1 && fakeProvider.sent.length === 1, "fake provider did not accept exactly one");
  assertCondition(fakeMessage.status === EmailMessageStatus.ACCEPTED_BY_PROVIDER && fakeMessage.providerName === "fake" && Boolean(fakeMessage.lastProviderMessageId), "fake provider identity not stored");
  record("fake provider sweep", "accepted one message and stored provider-qualified id");

  const concurrent = await enqueueSystemTest("concurrent");
  const sharedProvider = new FakeEmailProvider();
  await Promise.all([
    runEmailDeliverySweep({ provider: sharedProvider, limit: 1 }),
    runEmailDeliverySweep({ provider: sharedProvider, limit: 1 }),
  ]);
  const concurrentAttempts = await prisma.emailDeliveryAttempt.count({
    where: { emailMessageId: concurrent.messageId },
  });
  assertCondition(sharedProvider.sent.length === 1 && concurrentAttempts === 1, "concurrent workers sent more than once");
  record("concurrent workers", "two sweeps produced exactly one provider send and one attempt");

  const stale = await enqueueSystemTest("stale");
  const staleProvider = new StaleClaimProvider();
  const staleSweep = await runEmailDeliverySweep({ provider: staleProvider, limit: 1 });
  const staleMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: stale.messageId } });
  assertCondition(staleProvider.sent === 1 && staleSweep.accepted === 0 && staleSweep.skipped === 1, "stale claim was not reported as lost");
  assertCondition(staleMessage.status === EmailMessageStatus.PROCESSING && staleMessage.claimToken === `new-owner-${runId}`, "stale worker overwrote newer claim");
  record("stale claim fencing", "stale owner could not overwrite newer claim");
  await cancelMessage(stale.messageId);

  const suppressionRace = await enqueueSystemTest("suppression-race");
  const raceProvider = new FakeEmailProvider();
  const raceSweep = await runEmailDeliverySweep({
    provider: raceProvider,
    limit: 1,
    beforeSuppressionRecheck: async () => {
      await createActiveSuppression({
        recipientEmailNormalized: normalizeEmailAddress(recipient("suppression-race")),
        reason: EmailSuppressionReason.MANUAL,
        source: EmailSuppressionSource.SYSTEM,
      });
    },
  });
  const raceMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: suppressionRace.messageId } });
  const raceAttempts = await prisma.emailDeliveryAttempt.count({
    where: { emailMessageId: suppressionRace.messageId },
  });
  assertCondition(raceProvider.sent.length === 0 && raceSweep.suppressed === 1, "suppression race called provider");
  assertCondition(raceMessage.status === EmailMessageStatus.SUPPRESSED && raceMessage.attemptCount === 0 && raceAttempts === 0, "suppression race consumed an attempt");
  record("suppression recheck", "suppression after claim prevented provider send and attempt allocation");

  const unknown = await enqueueSystemTest("acceptance-unknown");
  const unknownProvider = new UnknownOutcomeProvider();
  const unknownSweep = await runEmailDeliverySweep({ provider: unknownProvider, limit: 1 });
  const unknownMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: unknown.messageId } });
  const secondUnknownSweep = await runEmailDeliverySweep({ provider: unknownProvider, limit: 10 });
  assertCondition(unknownSweep.acceptanceUnknown === 1 && unknownMessage.status === EmailMessageStatus.ACCEPTANCE_UNKNOWN && unknownMessage.nextAttemptAt === null, "acceptance unknown state failed");
  assertCondition(unknownProvider.sent === 1 && secondUnknownSweep.claimed === 0, "acceptance unknown was automatically retried");
  record("acceptance unknown", "ambiguous provider outcome is not automatically retried");

  const providerMessageId = fakeMessage.lastProviderMessageId;
  assertCondition(providerMessageId, "missing fake provider id");
  await processEmailProviderEvent({
    provider: "fake",
    providerEventId: `delivered-${runId}`,
    providerMessageId,
    eventType: EmailProviderEventType.DELIVERED,
    eventTime: new Date("2026-08-04T10:00:00.000Z"),
  });
  const delayed = await processEmailProviderEvent({
    provider: "fake",
    providerEventId: `delayed-${runId}`,
    providerMessageId,
    eventType: EmailProviderEventType.DELAYED,
    eventTime: new Date("2026-08-04T10:05:00.000Z"),
  });
  await processEmailProviderEvent({
    provider: "fake",
    providerEventId: `bounced-${runId}`,
    providerMessageId,
    eventType: EmailProviderEventType.BOUNCED,
    eventTime: new Date("2026-08-04T10:10:00.000Z"),
  });
  const deliveredAfterBounce = await processEmailProviderEvent({
    provider: "fake",
    providerEventId: `delivered-after-bounce-${runId}`,
    providerMessageId,
    eventType: EmailProviderEventType.DELIVERED,
    eventTime: new Date("2026-08-04T10:15:00.000Z"),
  });
  await processEmailProviderEvent({
    provider: "fake",
    providerEventId: `complained-${runId}`,
    providerMessageId,
    eventType: EmailProviderEventType.COMPLAINED,
    eventTime: new Date("2026-08-04T10:20:00.000Z"),
  });
  const eventedMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: fake.messageId } });
  assertCondition(delayed.processingStatus === EmailProviderEventProcessingStatus.IGNORED, "delayed downgraded delivered state");
  assertCondition(deliveredAfterBounce.processingStatus === EmailProviderEventProcessingStatus.IGNORED, "delivered downgraded bounced state");
  assertCondition(eventedMessage.status === EmailMessageStatus.COMPLAINED, "complaint did not become terminal");
  record("provider event ordering", "weaker events ignored; later complaint terminal");

  const unmatchedId = `late-${runId}`;
  const unmatched = await processEmailProviderEvent({
    provider: "fake",
    providerEventId: `unmatched-${runId}`,
    providerMessageId: unmatchedId,
    eventType: EmailProviderEventType.DELIVERED,
    eventTime: new Date("2026-08-04T11:00:00.000Z"),
  });
  const unmatchedDuplicate = await processEmailProviderEvent({
    provider: "fake",
    providerEventId: `unmatched-${runId}`,
    providerMessageId: unmatchedId,
    eventType: EmailProviderEventType.DELIVERED,
    eventTime: new Date("2026-08-04T11:00:00.000Z"),
  });
  assertCondition(unmatched.processingStatus === EmailProviderEventProcessingStatus.UNMATCHED && !unmatchedDuplicate.created, "unmatched duplicate handling failed");
  const late = await enqueueSystemTest("late-match");
  await prisma.emailMessage.update({
    where: { id: late.messageId },
    data: {
      status: EmailMessageStatus.ACCEPTANCE_UNKNOWN,
      providerName: "fake",
      lastProviderMessageId: unmatchedId,
      nextAttemptAt: null,
    },
  });
  await prisma.emailProviderEvent.update({
    where: {
      provider_providerEventId: {
        provider: "fake",
        providerEventId: `unmatched-${runId}`,
      },
    },
    data: { nextReconcileAt: new Date(Date.now() - 1000) },
  });
  const reconcile = await runEmailProviderEventReconciliationSweep({ limit: 10 });
  const lateMessage = await prisma.emailMessage.findUniqueOrThrow({ where: { id: late.messageId } });
  assertCondition(reconcile.processed >= 1 && lateMessage.status === EmailMessageStatus.DELIVERED, "unmatched reconciliation failed");
  record("unmatched event reconciliation", "unmatched event later matched and applied");

  const expired = await processEmailProviderEvent({
    provider: "fake",
    providerEventId: `expired-${runId}`,
    providerMessageId: `expired-${runId}`,
    eventType: EmailProviderEventType.UNKNOWN,
    eventTime: new Date("2026-08-04T12:00:00.000Z"),
  });
  assertCondition(expired.processingStatus === EmailProviderEventProcessingStatus.UNMATCHED, "expired fixture did not start unmatched");
  await prisma.emailProviderEvent.update({
    where: {
      provider_providerEventId: {
        provider: "fake",
        providerEventId: `expired-${runId}`,
      },
    },
    data: {
      nextReconcileAt: new Date(Date.now() - 1000),
      reconciliationDeadlineAt: new Date(Date.now() - 1000),
    },
  });
  const expiredSweep = await runEmailProviderEventReconciliationSweep({ limit: 10 });
  assertCondition(expiredSweep.ignored >= 1, "expired reconciliation was not ignored");
  record("reconciliation expiry", "unmatched event expired without infinite retry");

  process.env.EMAIL_CONTENT_RETENTION_DAYS = "1";
  process.env.EMAIL_PROVIDER_ID_RETENTION_DAYS = "1";
  process.env.EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS = "1";
  process.env.EMAIL_PROVIDER_EVENT_RETENTION_DAYS = "1";
  const oldDate = new Date("2026-01-01T00:00:00.000Z");
  const retentionMessage = await prisma.emailMessage.create({
    data: {
      messageType: EmailMessageType.SYSTEM_TEST,
      category: EmailMessageCategory.ADMIN_TEST,
      status: EmailMessageStatus.DELIVERED,
      recipientEmail: recipient("retention"),
      recipientEmailNormalized: normalizeEmailAddress(recipient("retention")),
      fromAddress: "no-reply@example.invalid",
      locale: "en",
      templateKey: "system-test",
      templateVersion: "1.0.0",
      renderedSubject: "retention",
      renderedTextBody: "retention",
      renderedHtmlBody: "<p>retention</p>",
      idempotencyKey: `stage313b:${runId}:retention`,
      providerName: "fake",
      lastProviderMessageId: `retention-${runId}`,
      sentAt: oldDate,
      deliveredAt: oldDate,
      createdAt: oldDate,
    },
  });
  await prisma.emailDeliveryAttempt.create({
    data: {
      emailMessageId: retentionMessage.id,
      attemptNumber: 1,
      provider: "fake",
      transport: "memory",
      status: EmailDeliveryAttemptStatus.ACCEPTED,
      providerMessageId: `retention-attempt-${runId}`,
      startedAt: oldDate,
      completedAt: oldDate,
    },
  });
  await prisma.emailProviderEvent.create({
    data: {
      provider: "fake",
      providerEventId: `retention-event-${runId}`,
      providerMessageId: `retention-${runId}`,
      emailMessageId: retentionMessage.id,
      eventType: EmailProviderEventType.DELIVERED,
      eventTime: oldDate,
      processingStatus: EmailProviderEventProcessingStatus.PROCESSED,
      processedAt: oldDate,
      createdAt: oldDate,
    },
  });
  await prisma.emailSuppression.create({
    data: {
      recipientEmailNormalized: normalizeEmailAddress(recipient("expired-suppression")),
      reason: EmailSuppressionReason.TEMPORARY,
      source: EmailSuppressionSource.SYSTEM,
      active: true,
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  const dryRunOne = await runEmailRetentionCleanup({ dryRun: true, limit: 100 });
  const dryRunTwo = await runEmailRetentionCleanup({ dryRun: true, limit: 100 });
  const cleanupOne = await runEmailRetentionCleanup({ dryRun: false, limit: 100 });
  const cleanupTwo = await runEmailRetentionCleanup({ dryRun: false, limit: 100 });
  const minimized = await prisma.emailMessage.findUniqueOrThrow({ where: { id: retentionMessage.id } });
  assertCondition(dryRunOne.contentCandidates >= 1 && dryRunTwo.contentCandidates >= 1, "retention dry-runs were not repeatable");
  assertCondition(cleanupOne.contentCleared >= 1 && cleanupTwo.contentCleared === 0, "retention cleanup was not idempotent");
  assertCondition(minimized.status === EmailMessageStatus.DELIVERED && minimized.renderedSubject === null && minimized.lastProviderMessageId === null, "retention minimization failed");
  record("retention", "dry-run twice and cleanup twice succeeded idempotently");

  console.log(JSON.stringify({ ok: true, runId, steps }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
