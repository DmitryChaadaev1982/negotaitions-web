# Semantic Action Contract

The Wave 1 semantic action model is UI-only.

It does not decide whether an action is available, authorized, disabled, or which route it should target. Existing callers continue to supply the condition, href, handler, and disabled state.

## Categories

- `PRIMARY_PROGRESS`: enter or continue the user's next active room path.
- `RETURN_TO_ACTIVE`: return to an already-open debrief or active continuation state.
- `REVIEW_RESULTS`: materials, results, reports, or transcripts.
- `NAVIGATION`: lobby, Events, Sessions, or detail navigation.
- `MANAGEMENT`: create/configure/copy/assignment actions.
- `WARNING`: cautionary lifecycle actions.
- `DESTRUCTIVE`: destructive or completion actions.
- `DISABLED`: explicitly unavailable visual state.

## Event Session Mapping

`resolveEventSessionPrimaryAction` remains the source of label and href for Event Session actions.

- `OPEN_ROOM` maps to `PRIMARY_PROGRESS`.
- `RETURN_TO_DEBRIEF` maps to `RETURN_TO_ACTIVE`.
- `OPEN_MATERIALS` maps to `REVIEW_RESULTS`.
- `OPEN_RESULTS` maps to `REVIEW_RESULTS`.

The rendered elements expose safe test attributes:

- `data-action-kind`
- `data-action-target`

These attributes contain only semantic category and target URL already visible in the link/button.

## Button Inventory Applied In Wave 1

component,label,condition,target_or_handler,previous_variant,new_semantic_category
`EventSessionRoomButton`,`events.openRoom`,existing `ALLOW_ACTIVE_ROOM`,existing `roomHref`,gradient,`PRIMARY_PROGRESS`
`EventSessionRoomButton`,`events.returnToDebrief`,existing `ALLOW_DEBRIEF`,existing `roomHref`,gradient,`RETURN_TO_ACTIVE`
`EventSessionRoomButton`,`events.openMaterials`,existing `REDIRECT_MATERIALS`,existing redirect/materials href,gradient,`REVIEW_RESULTS`
`EventSessionRoomButton`,`events.openResults`,existing `REDIRECT_EVENT_RESULTS`,existing redirect/materials href,gradient,`REVIEW_RESULTS`
`AccountDashboardView`,`dashboard.openRoom`,loader-supplied action,loader-supplied href,text link,`PRIMARY_PROGRESS`
`AccountDashboardView`,`dashboard.openMaterials`,loader-supplied action,loader-supplied href,text link,`REVIEW_RESULTS`
`AccountDashboardView`,`dashboard.openLobby`,loader-supplied action,loader-supplied href,text link,`NAVIGATION`
`EventHostControlsPanel`,`events.createSession`,selected case / setup visible,existing `handleCreateSession`,gradient/secondary,`MANAGEMENT`
`EventHostControlsPanel`,`events.openMaterials`,existing materials URL,existing `window.location.href`,secondary,`REVIEW_RESULTS`
`EventHostControlsPanel`,`events.copyRoomLinks`,Session exists,existing clipboard handler,secondary,`MANAGEMENT`

Out of Wave 1: repository-wide button migration, lists/filter redesign, room header actions, and provider controls.
