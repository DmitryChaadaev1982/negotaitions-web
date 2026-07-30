# Prioritization Decision

Checkpoint O2 status: PARTIAL — camera/stable-order priority only.

Implemented priority buckets:
1. Camera-enabled observers.
2. Connected observers.
3. Disconnected or recently disconnected observers.
4. Unknown connection/media state observers.

Within each bucket, stable roster order is preserved using the original roster index from `Session.participants` ordered by `createdAt ASC`.

Inputs used:
- `SessionRosterEntry.cameraEnabled`
- `ParticipantPresenceMediaModel.cameraStatus`
- `SessionRosterEntry.isLogicallyPresent`
- `ParticipantPresenceMediaModel.connectionStatus`
- Stable roster index

Inputs deliberately not used:
- Raw audio level.
- Persisted `SessionParticipantAudioActivity`.
- High-frequency polling or new telemetry.
- Facilitator pinning/manual ranking.

Rationale:
- Camera and connection state are already exposed to the room client without API/provider/schema changes.
- The room has remote speaking detection for tile highlight and telemetry submission, but there is no stable observer roster contract for active-speaker priority or anti-jump semantics.
- Deferring active-speaker sorting avoids visual jumping, unexpected focus movement, and accidental coupling to transcript/speaker-mapping telemetry.

Future work:
- Define an observer activity product contract before adding active/recent speaker priority.
- Consider virtualization only after provider/media lifecycle ownership for virtualized observer streams is explicitly designed.
