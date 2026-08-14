# 02 Domain Model

## Main Aggregates

- `User`, `UserSession`: account identity, status, and cookie-session auth.
- `NegotiationCase`, `CaseRole`: reusable training scenarios and private role briefs.
- `Session`, `SessionRole`, `SessionParticipant`: concrete negotiation runs.
- `TrainingEvent`, `EventParticipant`, `EventInvite`: event-level lobby and assignment.
- `Recording`, `Transcript`, `TranscriptSegment`, `AiAnalysis`: post-session processing chain.

`AiAnalysis` separates durable operation ownership from final publication:

- `runToken`, `leaseExpiresAt`, and `providerResponseId` own and recover the
  current durable provider operation;
- `analysisJson` remains the complete validated report;
- `sharedAnalysisJson` remains the sanitized participant/observer publication.

Queued/analyzing section placeholders are derived from operation status and do
not persist or expose nonterminal provider output.

## Session Lifecycle Model

- `Session.status`: `DRAFT | READY | COMPLETED`.
- `Session.negotiationState`: `PREPARATION -> READY_TO_START -> RUNNING -> FINISHED` with paused variants.
- Room/runtime checks and controls are role-gated by participant type and ownership.

## Account Preferences

- `User.preferredLocale`: persisted UI locale.
- `User.sessionSoundEnabled` (Stage 3.13E): persisted room-sound preference,
  non-null boolean with database default `true` and migration backfill for
  existing users.

## Recording/Transcript Model

- One `Recording` per `Session` (`sessionId` unique on `Recording`).
- One `Transcript` per `Session` (`sessionId` unique on `Transcript`).
- Transcript supports diarization, mapping status, versioned retranscription, and processing metadata.

## Event-to-Session Model

- Events can generate multiple sessions.
- Session-to-event membership is canonical through `Session.eventId ->
  TrainingEvent.id`.
- Event participants may be assigned into specific session participants.
- Sessions can be linked to events and carry snapshot data from case context.

## Event Scheduling Invariant

- Product invariant (application level): every newly created `TrainingEvent`
  receives a non-null `scheduledAt`.
- Create path fallback: when `scheduledAt` input is omitted, server actions set
  `scheduledAt` to current server time.
- Explicit invalid datetime/timezone combinations are rejected as validation
  errors and are never silently rewritten to current time.
- Event update preserves existing schedule when `scheduledAt` is omitted and
  rejects explicit clear attempts.
- Database schema remains `TrainingEvent.scheduledAt DateTime?` in this stage
  for legacy-row compatibility; no migration/backfill is implied by this
  invariant.

## Operational Telemetry Model

- `SessionParticipantAudioActivity` stores speaking activity windows.
- `ExternalServiceEvent` stores classified failure/health signals.
- `UsageCounter` stores service usage counters.

## Source Notes

- `prisma/schema.prisma`
- `app/actions/sessions.ts`
- `app/actions/events.ts`
