# 01 Product Context

## Purpose

NegotAItions is a negotiation training platform for running case-based sessions and event-based training lobbies, with post-session transcript and AI debrief workflows.

## Core Product Capabilities

- Case authoring and reuse (`NegotiationCase`, `CaseRole`).
- Standalone sessions with role assignment and facilitator controls.
- Multi-session training events with lobby assignment workflow.
- Live room runtime with provider switch (`livekit` or `voximplant`).
- Recording -> transcription -> speaker mapping -> AI analysis pipeline.
- Session materials and controlled analysis sharing.

## Primary User Roles

- `ADMIN`: account and diagnostics governance.
- `FACILITATOR`: session control, transcription, AI, sharing decisions.
- `PARTICIPANT`: role-based negotiation participation.
- `OBSERVER`: participation without negotiation role ownership.

## Product Boundaries

- Application is Next.js app-router based.
- Persistence is PostgreSQL via Prisma.
- External systems are used for video/recording/transcription/AI/storage.
- Runtime behavior is controlled by env-based provider selection and feature flags.

## Source Notes

- `app/actions/cases.ts`
- `app/actions/sessions.ts`
- `app/actions/events.ts`
- `prisma/schema.prisma`
- `docs/architecture/current-solution-audit.md`
