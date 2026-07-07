# 03 Application Architecture

## Runtime Stack

- Next.js app router application.
- Server actions for core CRUD and orchestration.
- Route handlers under `app/api/**` for room/event/materials/diagnostics workflows.
- Prisma client for persistence.

## Architectural Layers

- UI/Pages: `app/**`, `components/**`.
- Domain orchestration: `app/actions/**`, `lib/**`.
- Integration adapters: `lib/voximplant/**`, `lib/services/**`, `lib/storage/**`, `lib/ai/**`.
- Persistence: `prisma/schema.prisma`, `lib/prisma.ts`.

## Provider Selection

- Video provider: `getVideoProvider()` from `lib/env.ts`.
- Transcription provider: `getTranscriptionProvider()` from `lib/env.ts`.
- AI analysis provider: `getAiAnalysisProvider()` from `lib/env.ts`.

## Room Composition

- Shared orchestration shell: `components/shared-room-shell.tsx`.
- Provider-specific room implementation:
  - `components/video-room-page.tsx` (LiveKit).
  - `components/voximplant-negotiation-room-page.tsx` (Voximplant).

## API Domains

- Session control and room state.
- Event lobby state and assignment.
- Recording/transcription/materials.
- Speaker mapping and telemetry processing.
- Admin/service diagnostics.

## Source Notes

- `lib/env.ts`
- `lib/config.ts`
- `components/voximplant-negotiation-room-page.tsx`
- `lib/voximplant/use-voximplant-room.ts`
- `app/api/sessions/**`
- `app/api/events/**`
