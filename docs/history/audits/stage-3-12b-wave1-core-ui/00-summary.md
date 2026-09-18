# Stage 3.12B-W1 Core UI Summary

Branch: `ui/stage-3-12b-wave1-core-ui`

Base SHA: `57075368192dc5b7c0923e92156119065bbc4618`

Scope: first evolutionary UI optimization wave for dashboard hierarchy, Event lobby current-session visibility, semantic action presentation, compact persona/status rows, compact desired-role state, duplicate room-entry reduction, and RU/EN accessibility consistency.

Runtime preservation:

- No lifecycle change: `OPEN -> DEBRIEF_OPEN -> CLOSED` remains the room lifecycle contract.
- No route change.
- No authorization change.
- No observer rail change.
- No support for 3-8 negotiators.
- No filters redesign.
- No dashboard statistics, messages, calendar, or progress charts.
- No participant assignment redesign.
- No AI, transcript, speaker mapping, provider, lease, heartbeat, recording stop, or polling behavior change.

Deferred stages:

- Wave 2: scalable participant assignment workspace, 3-8 negotiator room layout, observer roster structure, filter density redesign, shared case-content presentation.
- Wave 3: dashboard statistics, messages, calendar, archive product model, observer prioritization, virtualization for very large rosters.
