# Mapping Preservation Contract

Future readability/timestamp work must preserve all rules below.

1. Manual label mapping remains available for facilitator workflows.
   - Evidence: `components/recording-transcription-section.tsx`, `speaker-mapping` API.
2. Label assignment propagates to matching segments by default.
   - Evidence: `applySpeakerMapping()` usage in `speaker-mapping/route.ts` and auto-trigger path.
3. Confirmation remains global and requires full label coverage.
   - Evidence: `deriveSpeakerMappingStatus()` and confirm guard in API.
4. Automatic thresholds and gating remain unchanged.
   - Evidence: `AUTO_MAPPING_*` constants, `decideAutoMappingApplication()`.
5. Ambiguous/unsafe/incomplete mapping is not auto-applied.
   - Evidence: non-apply path writes `speakerMapping=JsonNull`.
6. Participant names in diarized transcript rows are shown only for displayable states (`CONFIRMED`/`AUTO_SUGGESTED`).
   - Evidence: `isSpeakerMappingDisplayable()` in recording section.
7. Manual confirmation suppresses mapping-required warning state.
   - Evidence: state-driven review mode and readiness checks.
8. Re-transcription resets mapping only on successful new run; failed run restores prior snapshot.
   - Evidence: `materials/retranscribe` + `retranscription-safety`.
9. DeepSeek enhancement must keep mapping fields untouched.
   - Evidence: enhancement persistence updates only text fields.
10. Locked segment overrides must continue to block bulk cluster overwrites unless explicit force override is requested.
   - Evidence: `mappingLocked` guards in manual and auto update loops.

