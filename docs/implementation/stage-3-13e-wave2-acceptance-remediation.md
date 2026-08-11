# Stage 3.13E Wave 2 Acceptance Remediation

Date: 2026-08-11

## Scope

This pass remediates manual-acceptance defects in live-room status badges,
semantic notification audio, finish-line/debrief presentation, and public
invite origins. It covers both LiveKit and Voximplant room shells.

## Root causes

- Notification preference and browser runtime readiness were conflated. A
  persisted default-ON preference appeared as an amber action while the
  `AudioContext` was suspended.
- The room created its audio context only after mounting, so the trusted
  gesture used to enter the room could not be reused. The graph was not primed
  in that gesture and the original gain was too quiet for reliable acceptance.
- Notification controls were rendered outside the media-control sequence and
  provider control bars had no shared trailing-media slot.
- Timer status used generic text/icon presentation and the paused state lost
  final-minute/final-10 visual urgency.
- The finish-line deadline was not retained independently from the immediate
  canonical `FINISHED`/debrief transition.
- `RoomTimerPanel` explicitly returned `null` for `DEBRIEF`, removing the
  status card and final frozen time after the 2,500 ms finish line.
- Public links used runtime/browser origins in paths that could expose a
  localhost or internal deployment origin.

## Implemented fixes

### Notification audio and control

- Persisted `sessionSoundEnabled` defaults and backfills to `true`.
- The visible control follows the persisted preference: green
  `Notifications on` or red `Notifications off`.
- Browser runtime readiness is exposed separately through
  `data-audio-runtime`.
- A provider-independent shared `AudioContext` is primed on pointer/keyboard
  room-entry gestures and reused after client navigation.
- Room mount and the first trusted interaction retry `resume()` when needed.
- A click while preference is ON but runtime is blocked unlocks audio without
  turning the preference OFF.
- Semantic cues remain transition-deduplicated and now use an audible,
  restrained master gain.
- The compact control is injected immediately after camera for LiveKit and
  Voximplant.

### Timer, badges, finish line, and debrief

- Ten supplied state badges are mapped to their named presentation states.
- A separate normalized `status-debrief.png` is used only for debrief.
- Status artwork renders consistently with `object-contain`.
- Paused negotiation keeps its pause badge while timer/card tone reflects
  final-minute or final-10 urgency.
- Natural expiry and manual Finish render their respective strong finish-line
  badges for the authoritative remaining part of exactly 2,500 ms.
- After the deadline, the debrief panel opens but the timer/status card stays
  mounted. It shows `Debrief` / `Дебриф`, a discussion prompt, and the frozen
  final time (`00:00` for expiry or remaining time for manual Finish).

### Public invite links

- Public Event and standalone Session URLs use the canonical public origin.
- Localhost and loopback origins are rejected for shareable links.
- Production fallback is `https://negotaitions.ru`.

## Verification

Focused unit/contract coverage includes:

- semantic cue design, graph priming, transition mapping, and deduplication;
- default preference and ON/OFF control presentation;
- room-entry pointer/keyboard audio priming;
- provider control ordering after camera;
- status-badge mapping, paused urgency, finish-line variants, and persistent
  debrief presentation;
- canonical public-origin resolution and invite-link construction.

A focused Playwright scenario instruments the browser `AudioContext`, enters a
room from Event lobby, verifies that the entry gesture primes audio before
navigation, and checks green ON → red OFF → green ON control behavior.

## Deferred and browser constraints

- Browser autoplay policy cannot be bypassed for a direct URL load, refresh,
  or external navigation with no trusted user gesture. The first pointer or
  keyboard interaction inside the room performs the fallback unlock.
- Audio cues that occur while the browser context is blocked are intentionally
  discarded and are not replayed historically.
- The timer-centering changes touch `components/voximplant-video-layout.tsx`,
  so the full observer layout matrix is required once before completion in
  addition to the normal mandatory gates.
