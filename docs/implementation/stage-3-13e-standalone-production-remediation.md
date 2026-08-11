# Stage 3.13E Standalone Production Remediation

## Scope and evidence

- Production baseline: `601704bafde7da219fe1f1e37737e7769a09a6f9`.
- Branch: `feat/stage-3-13e-live-session-ux`.
- Target standalone Session: `cmsp3cscf0003lwm1svc9wo6d`.
- Comparison contract: the corresponding Event workflow completed without the
  three reported failures.
- Scope is limited to confirmed standalone regressions and the smallest shared
  concurrency fence needed to preserve one transcription/enhancement run.
- Incident B remains audit-only because the supplied evidence localizes the
  failure to Voximplant renegotiation but does not identify a safe application
  mutation.

Production inspection was read-only except for one accidental zero-byte
diagnostic file caused by shell redirect parsing. The file was removed
immediately, the deployed Git worktree was verified clean, and no database,
configuration, process, or application state was changed or restarted.

## Production incidents

1. After standalone facilitator reassignment, the newly assigned facilitator
   could not start Preparation until reconnecting.
2. Starting negotiation caused participant Voximplant calls/video to disappear;
   F5 restored them.
3. Two overlapping initial transcription runs completed without the expected
   automatic enhancement; a later single manual retranscription enhanced
   successfully.

## Standalone versus Event architecture map

| Concern | Standalone Session | Event / Event-created Session | Shared layer | Difference and risk | Incident |
|---|---|---|---|---|---|
| Session creation | Account Session action creates the Session directly | Event assignment creates a Session from an Event draft | `Session`, snapshots, roles | Intentional entry-point difference | Context |
| Facilitator assignment | Selected on Session creation/detail surfaces | Seeded from Event assignment/host configuration | `Session.facilitatorId`, `SessionParticipant` | Different setup, same runtime authority | A |
| Facilitator reassignment | Commonly occurs after a room connection already exists | Normally settled before room entry; explicit reassignment still uses the same service | `reassignSessionFacilitator` | Legacy service omitted active lease-role maintenance | A |
| Participant assignment | Direct Session participant management | Event assignment materializes Session participants | Session actions/creation helpers | Intentional orchestration difference | Context |
| Participant roles | Session detail actions mutate current Session roles/types | Event assignment seeds them from draft assignments | `SessionRole`, `SessionParticipant.type` | Same room contract after creation | A |
| `SessionParticipant` | Directly created/updated for standalone membership | Materialized for each Event-created Session | Participant resolver and room APIs | Shared room authority | A/B |
| `EventParticipant` | Absent | Persists Event-wide lobby/assignment identity | Event state/presence | Intentional Event-only aggregate | Context |
| Room authorization | Session visibility, current participant, account/join-token ownership | Same Session rules plus linked Event lifecycle | `decideSessionRoomAccess` | Event closure adds a guard; no START-time standalone branch | A/B |
| Room join/rejoin | Direct Session room entry | Event lobby handoff, then Session room entry | `/room/[sessionId]`, auth token, connection ID | Event has an extra lobby surface; room runtime is shared | B |
| `SessionRoomConnection` | Claimed on Session room APIs | Claimed after Event-to-Session handoff | Session lease service | Same row model; standalone reassignment more often occurs after claim | A |
| Lease role/identity | Snapshots participant role when claimed | Same | `SessionRoomConnection.role` and `connectionId` | Previously remained stale after reassignment | A |
| Facilitator control | Strict current participant + exact active facilitator lease + control CAS | Same | control/control-state/duration routes | Correct shared security contract | A |
| Voximplant access | Requested directly for the Session participant | Requested after Event handoff for the Session participant | Session Vox access route | Same provider access after room entry | B |
| Provider identity | Derived from Session participant/provider username | Same once inside Session | Vox access + WebSDK hook | No standalone provider-identity branch found | B |
| Room component selection | Provider chooses LiveKit or Voximplant room page | Same Session room selection | `app/room/[sessionId]/page.tsx` | No standalone/Event component fork | B |
| Lifecycle initialization | Fresh direct room load | Fresh load after lobby handoff | shared shell/provider page/hook | Different preceding navigation, same mounted room runtime | B |
| Preparation start | Existing standalone room connection can predate reassignment | Facilitator normally enters with final assignment | strict control transaction | Timing exposed stale standalone lease role | A |
| Negotiation start | Live `READY_TO_START -> RUNNING` in the room | Same when Event participants are already in the Session | control state + recording relay | No different React/provider transition code found | B |
| Participant video rendering | Vox layout merges roster and provider endpoints | Same | Vox hook/layout/shared shell | No state key, conditional unmount, or standalone filter found | B |
| Transcription trigger | Session detail and debrief/materials surfaces can overlap | Usually driven from the Event/room flow | materials transcription route + runner | Per-component refs did not serialize server admission | C |
| Enhancement trigger | Yandex runner invokes enhancement after raw persistence | Same | `executeTranscriptEnhancement` | Trigger is shared; duplicate transcription runs competed before reaching it | C |
| AI-analysis trigger | Facilitator starts analysis after usable transcript | Same | materials/analysis services | No causal difference found | Context |
| Completion/debrief | Standalone detail may remain open beside the room | Event host commonly remains in Event/room navigation | canonical completion/debrief/materials | Extra standalone surface made duplicate admission more likely | C |

The broader duplication between direct Session management and Event assignment
is technical debt. This remediation does not redesign Event lifecycle or
converge the two creation flows.

## Incident A — facilitator reassignment

### Root cause

`reassignSessionFacilitator` transactionally changed
`Session.facilitatorId`, promoted the selected `SessionParticipant`, and demoted
the previous facilitator participant. It did not update either user's active
`SessionRoomConnection.role`.

The room UI and participant resolver therefore showed the new facilitator, but
strict server control checked the already-open lease and still saw its old role.
Conversely, the old connection retained a facilitator role snapshot until a
refresh/rejoin replaced it.

Production journal evidence showed five `START_PREPARATION` attempts from the
old connection identity reaching `operation_started` without a successful
result. A newly claimed connection then completed the same action successfully.

### Classification

`STAGE_3_13E_EXPOSED_EXISTING_GAP`.

The reassignment lifecycle gap predated Stage 3.13E. Stage 3.13E correctly made
the exact active facilitator lease mandatory and therefore exposed the stale
role that the older standalone reassignment path had never maintained.

### Remediation

Within the existing reassignment transaction:

- promote the new facilitator's unexpired, non-final active lease to
  `FACILITATOR`;
- demote the previous facilitator's equivalent lease to the selected
  `PARTICIPANT` or `OBSERVER` fallback;
- leave expired, disconnected, superseded, and revoked rows terminal;
- retain strict lease validation and the control snapshot CAS unchanged.

No reload, lease bypass, or weakened authorization is introduced.

### Event impact and regression coverage

Event-created Sessions use the same canonical facilitator and control
authorization once inside the room. Their normal initial assignment is
unchanged; only explicit reassignment with an already-open lease gains the same
correct role maintenance.

Focused E2E coverage proves:

- standalone reassignment updates both participant and active lease roles;
- the new facilitator starts Preparation using the existing connection;
- the old facilitator is rejected;
- an Event-created Session facilitator still starts Preparation.

## Incident B — participant video disappears on START

### Confirmed evidence

Application/server evidence:

- `START` committed `RUNNING`;
- recording entered `starting` and `recording`;
- no room close or Session lease revocation occurred;
- all three logical room connections remained active;
- the Stage 3.13E commits did not change the Voximplant hook join/cleanup effect
  or add a standalone media branch.

Voximplant target log `4957506772`:

- VoxEngine version: `7.58.0`;
- participant calls received repeated `Call.IceRestart` events before START
  (`20:08:34`, `20:09:07/08`, and `20:09:40/41`);
- recorder creation began at `20:10:06.509`;
- the facilitator accepted the recorder ReInvite at `20:10:06.792` and stayed;
- participant accepts were delayed until `20:10:12.459` and
  `20:10:13.841`/`20:10:14.142`;
- those participant calls then disconnected at `20:10:13.473` and
  `20:10:14.836`.

Working comparison log `4957525014`:

- VoxEngine version: `7.59.0`;
- no equivalent ICE-restart churn appears before recorder creation;
- recorder creation began at `20:18:16.388`;
- all three calls accepted the ReInvite within approximately 0.3 seconds
  (`20:18:16.649`, `.658`, and `.681`);
- the participant calls remained connected.

After F5 in the target session, new calls joined at `20:11:49` while the
recorder already existed and accepted the resulting topology within
approximately 0.3 seconds.

### Intermediate root-cause assessment

The failure was a real provider-call disconnect, not merely an empty DOM tile.
The live transition introduced a recorder endpoint while affected calls already
had repeated ICE renegotiation activity. ReInvite completion then took 6–8
seconds and the calls cleared. F5 worked because it created fresh calls against
the already-established recorder topology, without the same pending live
recorder-add renegotiation.

This strongly supports a Voximplant WebSDK/ReInviteQueue/ICE interaction.
However, the supplied server-side provider logs do not reveal whether the
client failed an `IceRestartAction`, timed out a queued ReInvite, or threw in a
previously uncovered ReInvite payload shape. The `7.58.0` versus `7.59.0`
difference is correlation, not sufficient proof of a provider-version fix.

### Classification and decision

`UNKNOWN` (provider/WebSDK renegotiation failure strongly supported).

No Incident B runtime change is made. A forced reload, arbitrary delay,
recording semantic change, or reconnect retry would mask the failure without
fixing the proven cause and could regress the working Event flow.

The missing evidence is either:

- affected participant browser/WebSDK logs around
  `2026-08-11 20:09:30–20:10:20`, especially `ReInviteQueue`,
  `IceRestartAction`, `TransportTimeoutError`, `Action run failed`, `mids`,
  `handleReInvite`, and `Conference.Disconnected`; or
- Voximplant support analysis correlating target log `4957506772` with working
  log `4957525014` and the VoxEngine `7.58.0`/`7.59.0` difference.

Because no B code changed, no new test can honestly prove a remediation.
Existing ReInvite sanitizer tests remain relevant but do not reproduce the
delayed-accept/disconnect signature in the production log.

## Incident C — automatic transcript enhancement

### Root cause

Production did not use the legacy transcription route. It used the shared
Yandex `transcription-runner`, whose successful raw-persistence path correctly
calls `executeTranscriptEnhancement`.

The journal showed two initial transcription runs for the same standalone
Session approximately one second apart. Production transcript history then
showed:

- archived initial generation: completed raw transcript with no
  `transcriptEnhancement` metadata;
- one later manual retranscription: enhancement started and completed exactly
  once with `triggerSource=automatic_retranscription`.

Standalone Session detail/debrief processing surfaces each had only a local
component ref guarding auto-start. At the server, initial transcription and
retranscription performed a separate active-status read followed by an upsert.
Two requests could both pass the read, reset the same Transcript generation,
and start competing runners. Their raw/mapping writes and enhancement CAS
ownership could invalidate each other before automatic enhancement acquired a
stable run.

### Classification

`PRE_EXISTING_STANDALONE_BUG`.

The admission race is independent of Stage 3.13E and Stage 3.13D enhancement
fencing. Stage 3.13D correctly prevents stale enhancement writes; it does not
serialize two transcription provider runs admitted before that fence.

### Remediation

Both `/materials/transcribe` and `/materials/retranscribe` now:

1. lock the owning non-deleted Session row;
2. inspect current Transcript status while holding that lock;
3. prepare archive/generation state and commit the `QUEUED` claim in the same
   transaction;
4. start external provider work only after transaction commit.

A competitor waits, sees the active status, and returns `409`. This prevents
duplicate transcription and AI cost while retaining the one existing shared
post-transcription enhancement path.

### Event impact and regression coverage

The routes are shared, so Event semantics are unchanged for a normal single
request. Only duplicate concurrent admission changes: the second request is now
rejected instead of starting another provider run.

Coverage proves:

- concurrent standalone initial requests produce one success, one `409`, one
  Transcript, and generation zero;
- the equivalent Event-created Session remains single-run;
- simultaneous `automatic_initial_transcription` enhancement triggers execute
  the provider once and persist `COMPLETED` metadata with the automatic trigger
  source.

## Event regression protection

- Facilitator: Event-created Session `START_PREPARATION` remains successful.
- Transcription: Event-created Session duplicate admission produces one run and
  one controlled conflict.
- Enhancement: Event and standalone reach the same runner/orchestrator; the
  automatic-trigger idempotency test proves one provider execution.
- Video: no provider, layout, Event lobby, or Session room runtime file changed
  for Incident B.

## Technical debt deliberately not fixed

- Direct Session and Event assignment have separate creation/orchestration
  surfaces despite converging on the same room aggregates.
- Multiple post-processing UI surfaces can request the same operation. The
  server fence now makes this safe, but the UI could later expose a shared
  operation owner/status stream.
- The old `/transcribe-recording` route and component remain a separate legacy
  path and should be retired or explicitly mapped in a separate change.
- Voximplant WebSDK `5.1.0` requires a local ReInvite sanitizer. The current
  incident may represent a separate queued ICE/ReInvite failure and should be
  investigated with client logs/provider support before changing recovery
  semantics or dependencies.

## Validation status

Focused validation:

- `npm run agent:preflight` — PASS.
- `node --import ./scripts/test-unit-env-bootstrap.mjs --import tsx --test lib/services/transcript-enhancement-orchestration.test.ts`
  — PASS, 5/5.
- `npm run test:e2e:focused:managed -- tests/e2e/stage-3-13e-standalone-remediation.spec.ts --project=chromium`
  — PASS, 4/4.

Mandatory final gates are recorded in the final completion report after the
runtime diff stabilizes:

- `npm run validate:fast` — PASS (`1170` passed, `8` skipped, `0` failed).
- `npm run validate:deploy` — PASS (`1170` passed, `8` skipped, `0` failed;
  production build completed).
- `npm run test:e2e:db:check` — PASS (E2E database connected, `0` writes).
- `npm run test:stage310` — PASS (`102` unit tests and `41` Playwright tests).
- `npm run test:e2e:smoke` — PASS (`13` Playwright tests).
- `npm run test:e2e:smoke:browser` — PASS (`8` Playwright tests).
- `git diff --check` — PASS.

The gates ran against the remediation working tree based on runtime SHA
`601704bafde7da219fe1f1e37737e7769a09a6f9`. The final commit SHA is recorded
separately in the completion report; later changes after the heavy gates are
documentation-only.

The observer layout matrix is not triggered: no room geometry, participant
stage structure, rail/tile dimensions, responsive breakpoint, or room layout
runtime changed. Observer smoke is also not triggered because no shared room
provider lifecycle or Session navigation runtime changed.

## Manual production retest

Standalone Session:

1. Join the room as the old and proposed new facilitator before reassignment.
2. Reassign facilitator without refreshing either browser.
3. Confirm the new facilitator starts Preparation on the open connection.
4. Confirm the old facilitator cannot pause/resume/start/finish lifecycle.
5. Start negotiation and verify every participant keeps audio/video without F5.
6. Complete recording and start normal automatic transcription once.
7. Confirm transcript completion automatically enters visible enhancement
   lifecycle and completes once.

Event regression:

1. Create/enter an Event Session and start/finish Preparation.
2. Start negotiation and verify participant media remains connected.
3. Complete recording/transcription and confirm one automatic enhancement run.
