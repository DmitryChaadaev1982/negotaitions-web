# Final Demo Script (Facilitator + 2 Participants + 2 Observers)

## Pre-demo checks

1. `VIDEO_PROVIDER=voximplant`.
2. Auth/session env configured (`NEXTAUTH_URL`, secret, DB).
3. Voximplant env configured (account/app/domain/rule/scenario).
4. Webhook secret/base URL configured.
5. Storage and Yandex creds configured.
6. App starts and health checks pass.

## Browser/account setup

- Use 5 different user accounts for 5 demo roles.
- Same account in multiple tabs is expected to trigger newest-connection-wins and stale/kicked behavior.
- On one machine, only one tab typically has real camera access; others can join with video off.

## Recommended local simulation for 5 users

- 1 normal browser profile + 4 incognito/alternate profiles.
- Separate authenticated sessions per role:
  - Facilitator
  - Participant A
  - Participant B
  - Observer 1
  - Observer 2

## Demo flow

1. Create/open Event.
2. Facilitator joins Event Lobby.
3. Participant A joins.
4. Participant B joins.
5. Observer 1 joins.
6. Observer 2 joins.
7. Verify one card per unique user in lobby.
8. Confirm duplicate same-account tabs trigger newest-wins behavior.
9. Select case.
10. Assign roles.
11. Create/start session.
12. Validate lobby -> room transition for all roles.
13. Confirm room layout:
    - observers top
    - participant A left
    - facilitator/timer center
    - participant B right
14. Start negotiation.
15. Confirm recording starts.
16. Pause recording.
17. Resume recording.
18. Finish session.
19. Confirm recording stops.
20. Confirm webhook updates recording to completed.
21. Run transcription.
22. If needed, assign speaker roles manually.
23. Run AI analysis.
24. Share/send materials.
25. Verify observer sees only shared/general analysis.
26. Verify participant cannot see other participant private recommendations.
27. Verify facilitator sees full analysis.
28. Return to lobby/events.

## Success criteria

- No duplicate participants in lobby cards.
- Newest-connection-wins works for same account.
- Room layout and role mapping are correct.
- Recording lifecycle reaches COMPLETED.
- Transcription completes without provider errors.
- Analysis and materials visibility follow role policy.

## Troubleshooting table

| Symptom | Likely cause | Quick action |
|---|---|---|
| Playwright/dev server port conflict | `3100` in use | Set `PLAYWRIGHT_PORT=3000` |
| Recording webhook 401 | Signature mismatch / secret mismatch | Recheck `VOXIMPLANT_RECORDING_WEBHOOK_SECRET` in app + scenario |
| No recording file key | Scenario/storage URL parsing issue | Verify scenario object key extraction and bucket path |
| Poor transcript quality | Re-encode loss / low bitrate / low sample rate | Switch to `high` profile, run A/B test |
| Missing remote audio | Autoplay/device restrictions | Interact with page; verify device permissions |
| Observer sees private data | Visibility regression | Re-run materials/privacy regression specs |

## Audio A/B test procedure

Use same two speakers and same script (2-3 minutes):

1. Record profile A (current baseline).
2. Record profile B (`AUDIO_TRANSCRIPTION_QUALITY_PROFILE=high`).
3. Record profile C (`AUDIO_TRANSCRIPTION_QUALITY_PROFILE=diagnostic`).
4. Run SpeechKit transcription on all three.
5. Compare:
   - word errors
   - speaker labels
   - missing phrases
   - punctuation quality
   - role assignment quality
   - AI analysis quality
6. Keep selected profile in `docs/voximplant/env-checklist.md`.

## Audio metadata step (required)

After each sample recording:

```bash
npm run inspect:audio -- "<path-to-recording-file>"
```

Save output in Stage 3 final report for codec/rate/bitrate evidence.

