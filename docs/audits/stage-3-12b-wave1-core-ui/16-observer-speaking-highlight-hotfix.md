# Stage 3.12B-W1 — Observer Speaking Highlight Hotfix

Branch: `fix/stage-3-12b-observer-speaking-highlight`
Base: `origin/deploy/yandex-poc` @ `fc10cfd19552277d284a2f66f7145e232a37365a`

Affected production Session:
https://negotaitions.ru/room/cmsddpjtp003nvvm1j2ks3tm3

## 1. Observed Behavior

Observed user: `Паша`, role Observer / Наблюдатель.

- Observer microphone icon rendered as enabled (green).
- Observer camera rendered as enabled.
- Observer audio was apparently active.
- The observer tile kept the normal thin green connected border while the
  observer was speaking; the active-speaker highlight never appeared.
- Reproduced in active negotiation (`RUNNING`), during negotiation pause
  (`PAUSED`), and in `DEBRIEF_OPEN`.
- Participant A/B and facilitator speaking highlights kept working.

The Stage 3.12B reconnect media-state fix (`ea055d3`, `fc10cfd`) was already
deployed and behaved correctly: muted state, red muted border, reconnect
generation ownership, stale callback protection, and observer/facilitator media
state were all intact. None of that behavior was changed by this hotfix.

## 2. Speaking Data Flow (as deployed)

```
remote audio VoxStream
  → useVoximplantRoom.attachRemoteAudioStream / applyRemoteVideoStream
  → remoteParticipants[endpointId].audioStream
  → VoximplantVideoLayout.resolvedRosterTiles (roster ⨯ provider endpoint merge)
  → buildParticipantReconnectMediaState (generation, streamId, audioTrackPresent)
  → useRemoteSpeaking (AnalyserNode per participant, generation guarded)
  → observer rail tile / stage slot tile
  → VoximplantParticipantTile border resolver
```

Microphone state on a remote tile is authoritative from the published session
media status (`SessionRoomConnection`-scoped `micEnabled`). The speaking flag is
authoritative from a client-side `AnalyserNode` bound to the remote audio
`MediaStream`. The defect lived in the gap between those two sources.

## 3. Root Cause

**Detector attachment was broken, not rendering.**

Rendering was already role-agnostic and phase-agnostic: `canShowSpeakingHighlight`
was shared by every tile, the observer rail passed the same props as the stage
slots, and nothing in the speaking path read `NegotiationState`, `micAllowed`,
stage assignment, recording state, or timer state.

The analyser was never attached for the affected observer, because the endpoint's
tracked `audioStream` could get stuck at `null` after an audio remove/re-add
cycle:

1. `RemoteMediaRemoved` invoked `applyRemoteVideoStream`, which unconditionally
   overwrote `audioStream` with `endpoint.getAnyAudioStreams()[0]`. At that
   instant the endpoint exposed no audio stream, so the tracked stream became
   `null`. The stale `remoteAudioElements` entry for that stream was **not**
   released.
2. The following `RemoteMediaAdded` (audio) reached `attachRemoteAudioStream`,
   which returned early on `remoteAudioElements.has(key)` **before** publishing
   the stream, so `audioStream` was never restored.
3. From then on the tile still reported `micStatus = "on"` from the published
   media status — hence the green microphone icon and the thin green connected
   border — while `shouldAttachRemoteSpeakingMeter` saw no audio track and
   refused to create an analyser. `isSpeaking` stayed permanently `false`.

Because the state is sticky, it reproduced in every room phase once entered,
which matches the reported `RUNNING` / `PAUSED` / `DEBRIEF_OPEN` behavior.

**Why observers and facilitators, not participants.** `isMicAllowed` sets
`micAllowed=false` for `OBSERVER` and `FACILITATOR` during `RUNNING`, and the room
page enforces that policy by muting and later unmuting the local microphone when
the phase changes. That mute/unmute cycle is what produces remote audio
remove/re-add events for those roles. `PARTICIPANT` keeps `micAllowed=true`
throughout and never loses its original remote audio stream, which is why
participant highlights kept working.

A secondary contributor: the analyser was torn down whenever the audio
`MediaStream` object identity changed, even when it wrapped the same live track
(`streamToMediaStream` returns `new MediaStream([track])` when a VoxStream has no
`sourceStream`). Each teardown reset the speaking flag to `false`.

## 4. Fix

### 4.1 Shared speaking-state contract

`lib/voximplant/participant-presence-media-model.ts` gained
`canRenderSpeakingHighlight({ connected, stale, microphoneEnabled,
audioTrackPresent, isSpeaking, connectionGeneration, speakingGeneration })`.

`lib/voximplant/tile-speaking-state.ts` maps a rendered tile onto that rule
(`resolveTileSpeakingHighlight`) and owns the border precedence
(`resolveTileBorderState`). Every rendered room user — Participant A, Participant
B, Facilitator, Observer, local and remote — goes through the same rule. Role,
stage slot, observer rail membership, and negotiation phase are not inputs.

`canShowSpeakingHighlight` is retained for existing callers and tests.

### 4.2 Remote audio bookkeeping (the actual defect)

`lib/voximplant/remote-audio-registry.ts` (new, pure):

- `resolveRemoteAudioStream` prefers an endpoint stream with an enabled audio
  track, then the already attached stream while it still carries an enabled
  track, then any stream that still carries a track — and only returns `null`
  when nothing carries audio any more. An endpoint refresh can therefore never
  downgrade a live audio stream to `null`.
- `shouldCreateRemoteAudioElement` keeps `<audio>` playback idempotent without
  gating the publication of the tracked stream.
- `buildRemoteAudioElementKey` / `isRemoteAudioElementKeyForEndpoint` centralize
  the composite key.

`lib/voximplant/use-voximplant-room.ts`:

- `attachRemoteAudioStream` publishes the current audio stream **before** the
  playback idempotency guard, so a re-added stream always reaches the tile.
- `RemoteMediaRemoved` now releases the playback element of the specific removed
  audio stream, so a later re-add is not treated as already attached.
- `applyRemoteVideoStream` resolves audio through `resolveRemoteAudioStream`
  instead of overwriting it with `getAnyAudioStreams()[0]`.
- `upsertRemote` accepts an audio-stream resolver and preserves the existing
  display name when an audio-only upsert does not supply one.

Generation guards, stale-lifecycle guards, and the reconnect media-state
ownership rules were left exactly as deployed.

### 4.3 Analyser identity

`lib/voximplant/remote-speaking.ts`:

- meters are keyed by **audio track id** instead of `MediaStream` object
  identity, so re-wrapping the same live track keeps a working analyser while a
  replaced track always creates a new one;
- `resolveSpeakingSourceStream` picks the stream that actually carries enabled
  audio (audio stream first, then the video stream);
- `useRemoteSpeaking` returns generation-tagged state
  (`{ isSpeaking, generation }`) so a renderer can reject a signal produced by a
  superseded connection, endpoint, or audio track.

### 4.4 Tile

`components/voximplant-participant-tile.tsx` resolves its border through
`resolveTileBorderState` and exposes `data-tile-border-state` /
`data-speaking` for verification. Class names, geometry, and precedence are
unchanged.

## 5. Phase Behavior

Speaking visualization is derived only from an actual enabled audio track. It is
independent of `NegotiationState` and of `controlState.micAllowed`.

| Phase | Observer microphone policy | Speaking highlight |
| --- | --- | --- |
| `RUNNING` | `micAllowed=false` (policy mute); highlight shown whenever a real enabled track exists | yes |
| `PAUSED` | `micAllowed=true` | yes |
| `DEBRIEF_OPEN` | `micAllowed=true` | yes |

Microphone permissions are unchanged: the policy still decides whether the
observer *may* speak, never whether real speech is *visualized*.

## 6. Identity and Generation Behavior

- Observer speaking events are keyed by the provider endpoint id that the
  observer rail tile renders (`matchedRemote?.id ?? rosterEntry.id`), resolved
  through the normalized Voximplant username, so the analyser updates the same
  durable participant entry that is rendered.
- The generation key is
  `rosterEntryId : logicalConnectionId : providerEndpointId : streamId : mediaStatusUpdatedAt`.
  It is now computed once (`buildSpeakingConnectionGeneration`) and shared by the
  analyser input and the render-time guard.
- A level callback from an old generation is rejected by
  `shouldAcceptRemoteSpeakingLevel`, and a speaking flag tagged with an old
  generation is additionally rejected at render time.

## 7. Tile Precedence

Unchanged and now enforced in one resolver:

1. disconnected/stale;
2. muted (red);
3. active speaking (green highlight);
4. connected/default (thin green).

## 8. Observer Rail

Untouched: stable roster ordering, single row, compact tile widths
(`w-40 … sm:w-48 lg:w-52`), overflow scrolling and scroll buttons, camera-off
visibility, and immediate removal. The rail only receives a correct `isSpeaking`
value and applies the existing speaking border.

## 9. Focused Test Matrix

`lib/voximplant/observer-speaking-highlight.test.ts` (26 tests):

| # | Case | Result |
| --- | --- | --- |
| 1 | Observer current enabled track + speaking → highlight | pass |
| 2 | Observer enabled track + silence → connected border | pass |
| 3 | Observer muted + speaking signal → muted border, no highlight | pass |
| 4 | Observer missing track + speaking signal → no highlight | pass |
| 5 | Observer stale/disconnected + speaking signal → no highlight | pass |
| 6 | Observer speaking in `RUNNING` → highlight | pass |
| 7 | Observer speaking in `PAUSED` → highlight | pass |
| 8 | Observer speaking in `DEBRIEF_OPEN` → highlight | pass |
| 9 | Participant speaking unchanged | pass |
| 10 | Facilitator speaking unchanged | pass |
| 11 | Old observer generation speaking callback ignored | pass |
| 12 | Replacement observer track attaches a new analyser | pass |
| 13 | Removed observer track clears speaking | pass |
| 14 | Muting clears speaking immediately | pass |
| 15 | Observer rail mapping retains `isSpeaking` | pass |
| 16 | Border resolver prioritizes speaking over connected/default | pass |
| 17 | Muted state still overrides speaking | pass |
| 18 | Reconnect creates no duplicate analyser or tile | pass |

`lib/voximplant/remote-audio-registry.test.ts` (7 tests) covers the endpoint
audio-stream resolution and playback-element bookkeeping.

`lib/voximplant/remote-speaking.test.ts` (+9 tests) covers analyser identity,
speaking-source resolution, generation-aware lookup, and source-level regression
guards for the three `use-voximplant-room.ts` changes.

`tests/e2e/stage-3-12b-observer-speaking-highlight.spec.ts` (8 tests) uses a
deterministic provider/media simulation (fake `MediaStream`s and audio-level
events, no microphone hardware, no `AudioContext`) with a real session fixture:

- observer speaking in `RUNNING`, and return to the normal border when silent;
- observer speaking while the negotiation is paused;
- observer speaking in `DEBRIEF_OPEN`, with the lifecycle still `DEBRIEF_OPEN`;
- mute precedence (speaking clears, red muted border appears);
- reconnect regression (new analyser, old analyser callback rejected, exactly one
  active connection and one tile);
- stale endpoint refresh no longer strips the observer audio stream;
- shared-role regression for facilitator and Participant A/B;
- observer rail ordering and geometry unchanged.

## 10. Known Limitations

- The remote speaking flag remains a client-side `AnalyserNode` derivation, so
  each viewer computes it independently; there is no server-authoritative
  speaking signal.
- `REMOTE_SPEAKING_LEVEL_THRESHOLD` was not changed. It was not proven wrong for
  any role, and the defect was an attachment problem rather than a sensitivity
  problem.
- `audioTrackPresent` for the local tile is derived from the local audio stream
  existing (`localAudioStreamCreated`) rather than from a per-track inspection of
  the local Vox stream.
- The observer rail full layout matrix (`test:e2e:observer:layout`) was
  deliberately not run for this hotfix.
- Voximplant scenario, recording, session lifecycle, negotiation timing, pause
  behavior, media permissions, and lobby presence were not modified.
