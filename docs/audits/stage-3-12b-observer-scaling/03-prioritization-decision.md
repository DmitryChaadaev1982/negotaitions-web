# Ordering Decision

Checkpoint O2 status: corrected — stable roster order only.

Implemented order:
1. Stable roster order from `Session.participants`.
2. New observers append at the right end.
3. Reconnects retain the same position when the roster identity remains the same.

Observer ordering is stable roster order. Camera, microphone and connection states are represented within the tile. Automatic observer reordering is deferred because stable positioning is more important for usability and predictable scrolling.

Inputs used for visual order:
- Stable roster index.
- Stable React identity from `rosterEntry.id`.

Inputs deliberately not used for visual order:
- `SessionRosterEntry.cameraEnabled`.
- `ParticipantPresenceMediaModel.cameraStatus`.
- Microphone state.
- Connection state.
- Remote speaking state or raw audio level.
- Persisted `SessionParticipantAudioActivity`.
- High-frequency polling or new telemetry.
- Facilitator pinning/manual ranking.

Rationale:
- Camera-priority sorting moved earlier observers and could place newly added observers anywhere other than the right edge.
- Start-aligned overflow depends on stable first-to-last order so the earliest observers remain visible at the left edge.
- Media state remains visible through tile icons, labels, connection status, and speaking highlight without changing tile position.

Future work:
- Define an observer activity product contract before adding active/recent speaker priority.
- Consider virtualization only after provider/media lifecycle ownership for virtualized observer streams is explicitly designed.
