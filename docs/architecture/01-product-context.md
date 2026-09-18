# 01 Product Context

## Purpose

NegotAItions is a negotiation training platform for running case-based sessions and event-based training lobbies, with post-session transcript and AI debrief workflows. The same Next.js application also serves a public website at `/`. Public textual product name is `ПереговорИИ (NegotAItions)` in Russian and `NegotAItions` in English.

## Core Product Capabilities

- Case authoring and reuse (`NegotiationCase`, `CaseRole`).
- Standalone sessions with role assignment and facilitator controls.
- Multi-session training events with lobby assignment workflow.
- Live room runtime with provider switch (`livekit` or `voximplant`).
- Recording -> transcription -> speaker mapping -> AI analysis pipeline.
- Session materials and controlled analysis sharing.

## Primary User Roles

- `ADMIN`: account-level `User.globalRole` (or `ADMIN_EMAILS` allowlist).
  Account and diagnostics governance, plus Session/Event management through
  `canManageSession`. Not a session participant type.
- `FACILITATOR`: domain-scoped session/event control. Canonical Session
  owner is `Session.facilitatorId`. Participant type `FACILITATOR` is
  membership, not a global account role. Type-based membership is not
  by itself a proven management requirement; see FIND-01.
- `PARTICIPANT`: role-based negotiation participation.
- `OBSERVER`: participation without negotiation role ownership.

Legacy `User.role` enum values are not access-control authority.

## Product Boundaries

- Application is Next.js app-router based.
- Persistence is PostgreSQL via Prisma.
- External systems are used for video/recording/transcription/AI/storage.
- Runtime behavior is controlled by env-based provider selection and feature flags.

## Implementation anchors

- `app/actions/cases.ts`, `app/actions/sessions.ts`, `app/actions/events.ts`
- `prisma/schema.prisma`
- Requirements: `docs/requirements/PRODUCT-REQUIREMENTS.md`
- Navigation: `code-map.md`

## Source Notes

- `app/actions/cases.ts`
- `app/actions/sessions.ts`
- `app/actions/events.ts`
- `prisma/schema.prisma`
