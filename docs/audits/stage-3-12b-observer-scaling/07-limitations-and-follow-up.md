# Limitations And Follow-Up

Known limitations:
- The 100-observer case is deterministic roster rendering, not 100 live browser contexts or 100 simultaneous provider streams.
- Active-speaker observer prioritization is deferred because the existing audio activity data is telemetry/transcript-oriented and not a stable observer roster contract.
- No observer virtualization is introduced. Every observer-zone roster entry remains mounted in the rail.
- The observer tile still uses the existing Voximplant participant tile. This preserves media binding behavior but keeps the existing compact icon treatment rather than introducing a new design system.

Deferred architecture work:
- 3-8 negotiator layout model.
- Observer active/recent speaker product contract.
- Manual observer pinning/ranking.
- Provider/media lifecycle support for future virtualization.
- Broader right-sidebar redesign.
- AI analysis, transcript prompt, and speaker mapping changes.

Operational note:
- The implementation intentionally avoids Prisma schema changes, migrations, new API contracts, provider callbacks, room access changes, room lease changes, recording changes, and event assignment changes.
