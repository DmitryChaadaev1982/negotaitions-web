# Mapping UI Inventory

## `components/recording-transcription-section.tsx`

- Component: `RecordingTranscriptionSection`.
- Inputs: `sessionId`, `roomAuth`, `readOnly`, lock/embedding flags.
- Source API:
  - `GET /api/sessions/[sessionId]/recording`
  - writes to `speaker-mapping`, `manual-speaker-attribution`, retranscribe routes.
- Mapping renders:
  - detected technical labels;
  - participant selectors per label;
  - assisted review card (suggestions/confidence);
  - auto-applied note;
  - compact failure reasons via i18n keys;
  - diarized transcript speaker names (mapped name vs raw label).
- Controls:
  - save mapping (with implicit confirm when all assigned);
  - apply suggestion;
  - skip mapping for now;
  - manual attribution mode controls;
  - rerun transcription.

## `components/speaker-mapping-panel.tsx`

- Separate mapping panel component (same endpoint family).
- Uses:
  - `GET /speaker-mapping`
  - `POST /speaker-mapping` for suggest/save/confirm.
- Displays:
  - label rows with selector or read-only participant;
  - confidence hints from suggestion;
  - unavailable messages;
  - confirmed badge.

## `components/session-post-processing-panel.tsx`

- Orchestrates status polling and step-level UI cards.
- Consumes `/materials/status` where `speakerMappingRequired` gates AI analysis actions.

## `lib/transcription/assisted-speaker-mapping.ts`

- UI-mode helpers:
  - `resolveSpeakerReviewMode()`: `REVIEW_CARD | AUTO_APPLIED_NOTE | NONE`.
  - `resolveAssistedMappingSuggestion()`: suggested map and confidence levels.

## Message rendering linkage

- Warning/failure text uses `mappingFailureI18nKey` and related compact keys from API.
- Confirmation/review card text uses static dictionary keys (`recording.confirmSpeakers*`, `recording.speakerMapping*`).

