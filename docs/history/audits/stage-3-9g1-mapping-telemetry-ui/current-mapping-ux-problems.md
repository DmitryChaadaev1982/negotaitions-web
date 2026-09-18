# Current Mapping UX Problems

## 1) `MESSAGE_TOO_GENERIC` (medium, high confidence)

- Component/message:
  - compact generic failure (`recording.mappingFailureCompact.generic`);
  - future-only unavailability text in panel (`room.autoMappingFutureOnly` / `recording.autoMappingFutureSessionsOnly`).
- Underlying state:
  - diagnostics often include specific reason/warnings (`processingMetadata.mappingSuggestion.reason`, telemetry warnings).
- Why misleading:
  - user sees generic "manual mapping required" even when exact actionable reason exists.
- Affected action:
  - deciding whether to fix telemetry vs directly assign manually.
- Safest UI-only clarification:
  - prefer specific reason text when available before fallback generic copy.

## 2) `SUGGESTION_LOOKS_CONFIRMED` (low-medium, medium confidence)

- Component/message:
  - `AUTO_SUGGESTED` note and successful save messages.
- Underlying state:
  - `AUTO_SUGGESTED` is persisted auto-apply, but not facilitator-confirmed (`speakerMappingConfirmedAt` may be null).
- Why potentially misleading:
  - users may treat auto-applied as final confirmation.
- Affected action:
  - may skip explicit confirm/review in sensitive sessions.
- Safest UI-only clarification:
  - keep auto-applied note but explicitly say "not facilitator-confirmed yet" where appropriate.

## 3) `GLOBAL_FAILURE_HIDES_VALID_SUGGESTION` (medium, medium confidence)

- Component/message:
  - global failure title/reason while review card still shows per-label suggestions.
- Underlying state:
  - diagnostics can include useful candidate mapping but status remains `REQUIRED`/`NEEDS_REVIEW`.
- Why misleading:
  - "automatic mapping not completed" can be interpreted as "no suggestion at all."
- Affected action:
  - facilitator may ignore valid suggestions and remap from scratch.
- Safest UI-only clarification:
  - explicit phrasing: "Auto-apply skipped; suggested assignments still available for review."

## 4) `NO_USER_FACING_PROBLEM` items

- No evidence found that failure warning remains after `CONFIRMED` in current flow.
- No evidence found of participant names shown as mapped while state stays non-displayable in main diarized row rendering path.

