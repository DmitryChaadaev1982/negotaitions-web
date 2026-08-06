import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { assertApprovedStage313cVerifierChildEnvironment } from "./stage-3-13c-test-database";

let expectedSchema: string;
try {
  expectedSchema =
    assertApprovedStage313cVerifierChildEnvironment(process.env).schemaName;
} catch {
  console.error(JSON.stringify({ ok: false, counts: { safetyRefusals: 1 } }));
  process.exit(1);
}

/**
 * Stage 3.13C provider-event remediation verifier.
 *
 * Proves against a real disposable PostgreSQL schema that:
 *   F-03 the parse-time bounce classification survives persistence and
 *        reconciliation, so a transient bounce never becomes a hard-bounce
 *        suppression and an unmatched transient bounce stays unsuppressed;
 *   F-17 provider-controlled diagnostic text never lands in event metadata;
 *   F-11 the ingestion-failure ledger stores only allowlisted static messages.
 *
 * Never contacts Postbox, Data Streams, or any cloud endpoint: the provider is
 * the in-memory fake and every provider event is a locally constructed payload.
 */

for (const key of [
  "YANDEX_POSTBOX_ACCESS_KEY_ID",
  "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
  "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
  "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
]) {
  delete process.env[key];
}

Object.assign(process.env, {
  EMAIL_DELIVERY_ENABLED: "true",
  EMAIL_PROVIDER: "fake",
  EMAIL_ADMIN_TEST_ENABLED: "true",
  EMAIL_CANONICAL_BASE_URL: "https://negotaitions.ru",
  EMAIL_LOCAL_PREVIEW_ENABLED: "false",
  EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS: "3600",
  // Lowest value the runtime parser accepts; the unmatched-bounce case forces
  // nextReconcileAt into the past explicitly, so the delay is not load-bearing.
  EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS: "5",
});

/** Provider label the Postbox stream parser emits on every provider event. */
const PROVIDER = "yandex_postbox";

const runId = randomBytes(4).toString("hex");
const counts: Record<string, number> = {};
const ownedEmails: string[] = [];
let prisma: (typeof import("@/lib/prisma"))["prisma"] | undefined;
let currentCase = "bootstrap";

function record(name: string, value: number) {
  counts[name] = value;
}

/**
 * Recipient-shaped strings a hostile provider could embed in a bounce. None of
 * them may appear anywhere in the database after ingestion.
 */
function hostileDiagnostics(address: string): string[] {
  return [
    `smtp; 550 5.1.1 <${address}>: Recipient address rejected: User unknown`,
    "smtp; 452 4.2.2 mailbox full\r\nX-Injected-Header: attacker",
    `smtp; 550 ${"A".repeat(5000)}`,
    "smtp; 550 \u0000\u0007\u001b[31mcontrol sequence\u001b[0m",
  ];
}

async function main() {
  const [
    prismaModule,
    outbox,
    providerModule,
    workerModule,
    providerEvents,
    parserModule,
    generated,
  ] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/email/outbox"),
    import("@/lib/email/provider"),
    import("@/lib/email/worker"),
    import("@/lib/email/provider-events"),
    import("@/lib/email/yandex-postbox-provider-event-parser"),
    import("@/app/generated/prisma/client"),
  ]);
  prisma = prismaModule.prisma;
  const db = prismaModule.prisma;
  const { enqueueEmail } = outbox;
  const { FakeEmailProvider } = providerModule;
  const { runEmailDeliverySweep } = workerModule;
  const {
    processEmailProviderEvent,
    runEmailProviderEventReconciliationSweep,
  } = providerEvents;
  const { parseYandexPostboxProviderEvent } = parserModule;
  const {
    EmailMessageCategory,
    EmailMessageStatus,
    EmailMessageType,
    EmailProviderEventProcessingStatus,
    EmailProviderEventSuppressionDisposition,
    EmailProviderEventType,
    EmailSuppressionReason,
  } = generated;

  currentCase = "prisma_search_path";
  const searchPath = await db.$queryRaw<{ schema_name: string | null }[]>`
    SELECT current_schema() AS schema_name
  `;
  assert.equal(searchPath[0]?.schema_name, expectedSchema);

  const recipientFor = (label: string) =>
    `stage313c-pe-${label}-${runId}@example.invalid`;

  /** Enqueues and delivers one message so a provider message id exists. */
  async function deliverMessage(label: string) {
    const address = recipientFor(label);
    ownedEmails.push(address.toLowerCase());
    const enqueued = await enqueueEmail({
      messageType: EmailMessageType.SYSTEM_TEST,
      category: EmailMessageCategory.ADMIN_TEST,
      recipientEmail: address,
      locale: "en",
      templateKey: "system-test",
      variables: {
        adminName: "Stage313C Admin",
        generatedAt: new Date().toISOString(),
        canonicalBaseUrl: "https://negotaitions.ru",
        supportEmail: "support@example.invalid",
        operatorName: "Stage313C Operator",
        reason: label,
      },
      idempotencyKey: `stage313c-pe:${runId}:${label}`,
      metadata: { source: "stage313c_provider_event_verify", label },
    });
    assert.ok(enqueued.created);
    await runEmailDeliverySweep({ provider: new FakeEmailProvider(), limit: 1 });
    // Provider-event reconciliation matches on the provider-qualified message
    // id, so the fixture must record the same provider the stream events name.
    // No Postbox call is made: only the stored provider label is aligned.
    const message = await db.emailMessage.update({
      where: { id: enqueued.messageId },
      data: { providerName: PROVIDER },
    });
    assert.ok(message.lastProviderMessageId);
    return {
      address,
      normalized: address.toLowerCase(),
      messageId: message.id,
      providerMessageId: message.lastProviderMessageId,
    };
  }

  function bouncePayload(params: {
    eventId: string;
    providerMessageId: string;
    bounce: Record<string, unknown>;
  }) {
    return JSON.stringify({
      eventId: params.eventId,
      eventType: "Bounce",
      mail: {
        messageId: params.providerMessageId,
        timestamp: new Date().toISOString(),
      },
      bounce: params.bounce,
    });
  }

  function parse(payload: string) {
    return parseYandexPostboxProviderEvent(payload, {
      maxPayloadBytes: 262_144,
    });
  }

  async function suppressionsFor(normalized: string) {
    return db.emailSuppression.findMany({
      where: { recipientEmailNormalized: normalized },
    });
  }

  // --- F-03: permanent bounce still suppresses -----------------------------
  currentCase = "permanent_general_bounce_suppresses";
  const permanent = await deliverMessage("permanent-general");
  const permanentEvent = parse(
    bouncePayload({
      eventId: `perm-${runId}`,
      providerMessageId: permanent.providerMessageId,
      bounce: {
        bounceType: "Permanent",
        bounceSubType: "General",
        diagnosticCodes: hostileDiagnostics(permanent.address),
      },
    }),
  );
  assert.equal(
    permanentEvent.suppressionDisposition,
    EmailProviderEventSuppressionDisposition.HARD_BOUNCE,
  );
  await processEmailProviderEvent(permanentEvent);
  const permanentSuppressions = await suppressionsFor(permanent.normalized);
  assert.equal(permanentSuppressions.length, 1);
  assert.equal(
    permanentSuppressions[0]?.reason,
    EmailSuppressionReason.HARD_BOUNCE,
  );
  record("permanentGeneralSuppressions", permanentSuppressions.length);

  // --- F-03: transient bounces must never suppress -------------------------
  currentCase = "transient_bounces_do_not_suppress";
  const transientSubTypes = [
    "General",
    "MailboxFull",
    "MessageTooLarge",
    "ContentRejected",
  ] as const;
  let transientEventsIngested = 0;
  for (const subType of transientSubTypes) {
    const label = `transient-${subType.toLowerCase()}`;
    const target = await deliverMessage(label);
    const event = parse(
      bouncePayload({
        eventId: `${label}-${runId}`,
        providerMessageId: target.providerMessageId,
        bounce: {
          bounceType: "Transient",
          bounceSubType: subType,
          diagnosticCodes: hostileDiagnostics(target.address),
        },
      }),
    );
    assert.equal(
      event.suppressionDisposition,
      EmailProviderEventSuppressionDisposition.NONE,
      `${subType} was classified as suppressing`,
    );
    await processEmailProviderEvent(event);
    transientEventsIngested += 1;

    const stored = await db.emailProviderEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: {
          provider: "yandex_postbox",
          providerEventId: `${label}-${runId}`,
        },
      },
    });
    assert.equal(stored.eventType, EmailProviderEventType.BOUNCED);
    // The disposition is durable, so reconciliation never re-derives
    // permanence from the event type alone.
    assert.equal(
      stored.suppressionDisposition,
      EmailProviderEventSuppressionDisposition.NONE,
    );
    assert.equal((await suppressionsFor(target.normalized)).length, 0);

    // A duplicate delivery of the same transient bounce stays unsuppressed.
    await processEmailProviderEvent(event);
    assert.equal((await suppressionsFor(target.normalized)).length, 0);

    const message = await db.emailMessage.findUniqueOrThrow({
      where: { id: target.messageId },
    });
    assert.equal(message.status, EmailMessageStatus.BOUNCED);
  }
  record("transientBounceEvents", transientEventsIngested);
  record("transientBounceSuppressions", 0);

  // --- F-03: unmatched transient bounce reconciled later -------------------
  currentCase = "unmatched_transient_bounce_reconciles_unsuppressed";
  const lateProviderMessageId = `late-provider-${runId}`;
  const lateEvent = parse(
    bouncePayload({
      eventId: `late-${runId}`,
      providerMessageId: lateProviderMessageId,
      bounce: { bounceType: "Transient", bounceSubType: "General" },
    }),
  );
  const unmatched = await processEmailProviderEvent(lateEvent);
  assert.equal(
    unmatched.processingStatus,
    EmailProviderEventProcessingStatus.UNMATCHED,
  );

  const late = await deliverMessage("late-match");
  await db.emailMessage.update({
    where: { id: late.messageId },
    data: { lastProviderMessageId: lateProviderMessageId },
  });
  await db.emailProviderEvent.update({
    where: {
      provider_providerEventId: {
        provider: "yandex_postbox",
        providerEventId: `late-${runId}`,
      },
    },
    data: { nextReconcileAt: new Date(Date.now() - 1000) },
  });
  const sweep = await runEmailProviderEventReconciliationSweep({ limit: 25 });
  assert.ok(sweep.processed >= 1);
  const lateMessage = await db.emailMessage.findUniqueOrThrow({
    where: { id: late.messageId },
  });
  assert.equal(lateMessage.status, EmailMessageStatus.BOUNCED);
  assert.equal((await suppressionsFor(late.normalized)).length, 0);
  record("reconciledTransientSuppressions", 0);

  // --- F-03: complaints still suppress -------------------------------------
  currentCase = "complaint_suppresses";
  const complaintTarget = await deliverMessage("complaint");
  const complaintEvent = parse(
    JSON.stringify({
      eventId: `complaint-${runId}`,
      eventType: "Complaint",
      mail: {
        messageId: complaintTarget.providerMessageId,
        timestamp: new Date().toISOString(),
      },
      complaint: { complaintFeedbackType: "abuse" },
    }),
  );
  await processEmailProviderEvent(complaintEvent);
  const complaintSuppressions = await suppressionsFor(
    complaintTarget.normalized,
  );
  assert.equal(complaintSuppressions.length, 1);
  assert.equal(
    complaintSuppressions[0]?.reason,
    EmailSuppressionReason.COMPLAINT,
  );
  record("complaintSuppressions", complaintSuppressions.length);

  // --- F-17 / F-11: no provider-controlled text anywhere in the database ---
  currentCase = "no_pii_in_persisted_rows";
  const storedEvents = await db.emailProviderEvent.findMany();
  const storedFailures = await db.emailProviderIngestionFailure.findMany();
  const storedSuppressions = await db.emailSuppression.findMany();
  const persisted = JSON.stringify({
    events: storedEvents.map((event) => ({
      metadata: event.metadata,
      processingResultCode: event.processingResultCode,
      processingResultMessage: event.processingResultMessage,
    })),
    failures: storedFailures,
    suppressions: storedSuppressions.map((row) => row.metadata),
  });
  for (const forbidden of [
    "Recipient address rejected",
    "X-Injected-Header",
    "mailbox full",
    "AAAAAAAAAA",
    "\u001b[31m",
    "diagnosticCodes",
  ]) {
    assert.ok(
      !persisted.includes(forbidden),
      `provider-controlled text reached the database: ${forbidden}`,
    );
  }
  // Only the count survives from the diagnostic array.
  const bounceMetadata = storedEvents
    .filter((event) => event.eventType === EmailProviderEventType.BOUNCED)
    .map((event) => event.metadata as Record<string, unknown> | null);
  assert.ok(bounceMetadata.length > 0);
  for (const metadata of bounceMetadata) {
    assert.ok(metadata);
    assert.equal(typeof metadata.diagnosticCodeCount, "number");
    assert.ok(["permanent", "transient", "undetermined"].includes(
      String(metadata.bounceClass),
    ));
  }
  record("providerEventsInspected", storedEvents.length);
  record("ingestionFailuresInspected", storedFailures.length);

  // --- F-11: ledger rows only ever carry static allowlisted messages -------
  currentCase = "failure_ledger_messages_are_static";
  const { DETERMINISTIC_INGESTION_FAILURE_MESSAGES, UNEXPECTED_INGESTION_ERROR_MESSAGE } =
    await import("@/lib/email/provider-event-consumer");
  const allowedMessages = new Set<string>([
    ...Object.values(DETERMINISTIC_INGESTION_FAILURE_MESSAGES),
    UNEXPECTED_INGESTION_ERROR_MESSAGE,
  ]);
  for (const failure of storedFailures) {
    assert.ok(
      allowedMessages.has(failure.sanitizedErrorMessage),
      "ingestion-failure ledger contains a non-allowlisted message",
    );
  }
  record("allowlistedLedgerMessages", allowedMessages.size);

  // --- Additive schema fields behave as designed ---------------------------
  currentCase = "additive_schema_fields";
  const checkpoint = await db.emailProviderStreamCheckpoint.create({
    data: {
      provider: "yandex_postbox",
      streamName: `verify-${runId}`,
      shardId: "shard-000",
    },
  });
  // Nullable by design: an older runtime that never writes it keeps working.
  assert.equal(checkpoint.initialReadAt, null);
  const boundary = new Date();
  const updated = await db.emailProviderStreamCheckpoint.update({
    where: { id: checkpoint.id },
    data: { initialReadAt: boundary },
  });
  assert.equal(updated.initialReadAt?.getTime(), boundary.getTime());
  await db.emailProviderStreamCheckpoint.delete({
    where: { id: checkpoint.id },
  });
  record("additiveCheckpointFields", 1);
}

async function cleanup() {
  if (!prisma) return;
  await prisma.emailProviderEvent.deleteMany({
    where: { providerEventId: { contains: runId } },
  });
  await prisma.emailProviderIngestionFailure.deleteMany({
    where: { streamName: { contains: runId } },
  });
  await prisma.emailProviderStreamCheckpoint.deleteMany({
    where: { streamName: { contains: runId } },
  });
  if (ownedEmails.length > 0) {
    await prisma.emailMessage.deleteMany({
      where: { recipientEmailNormalized: { in: ownedEmails } },
    });
    await prisma.emailSuppression.deleteMany({
      where: { recipientEmailNormalized: { in: ownedEmails } },
    });
  }
}

const originalLog = console.log;
const originalError = console.error;

async function run() {
  let succeeded = false;
  try {
    await main();
    succeeded = true;
  } catch {
    // Deliberately swallowed: only the sanitized case label is reported so no
    // exception text can reach the harness output.
    process.exitCode = 1;
  } finally {
    try {
      await cleanup();
    } catch {
      succeeded = false;
      process.exitCode = 1;
    } finally {
      await prisma?.$disconnect();
    }
  }

  if (succeeded) {
    originalLog(JSON.stringify({ ok: true, counts }));
  } else {
    originalError(
      JSON.stringify({
        ok: false,
        counts: { ...counts, failures: 1 },
        cases: [currentCase],
      }),
    );
  }
}

void run();
