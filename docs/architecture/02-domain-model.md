# 02 Domain Model

## Main Aggregates

- `User`, `UserSession`: account identity, status, and cookie-session auth.
- `NegotiationCase`, `CaseRole`: reusable training scenarios and private role briefs.
- `Session`, `SessionRole`, `SessionParticipant`: concrete negotiation runs.
- `TrainingEvent`, `EventParticipant`, `EventInvite`: event-level lobby and assignment.
- `Recording`, `Transcript`, `TranscriptSegment`, `AiAnalysis`: post-session processing chain.

`AiAnalysis` separates operation ownership, progressive display, and final
publication:

- `runToken`, `leaseExpiresAt`, and `providerResponseId` own and recover the
  current durable provider operation;
- nullable `progressJson` stores only validated facilitator section snapshots
  for the current queued/analyzing run;
- `analysisJson` remains the complete validated report;
- `sharedAnalysisJson` remains the sanitized participant/observer publication.

## Session Lifecycle Model

- `Session.status`: `DRAFT | READY | COMPLETED`.
- `Session.negotiationState`: `PREPARATION -> READY_TO_START -> RUNNING -> FINISHED` with paused variants.
- Room/runtime checks and controls are role-gated by participant type and ownership.

## Recording/Transcript Model

- One `Recording` per `Session` (`sessionId` unique on `Recording`).
- One `Transcript` per `Session` (`sessionId` unique on `Transcript`).
- Transcript supports diarization, mapping status, versioned retranscription, and processing metadata.

## Event-to-Session Model

- Events can generate multiple sessions.
- Event participants may be assigned into specific session participants.
- Sessions can be linked to events and carry snapshot data from case context.

## Operational Telemetry Model

- `SessionParticipantAudioActivity` stores speaking activity windows.
- `ExternalServiceEvent` stores classified failure/health signals.
- `UsageCounter` stores service usage counters.

## Source Notes

- `prisma/schema.prisma`
- `app/actions/sessions.ts`
- `app/actions/events.ts`
