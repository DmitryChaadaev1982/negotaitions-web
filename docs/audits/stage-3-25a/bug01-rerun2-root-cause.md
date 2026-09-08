# CU-3.25A-BUG01-RERUN2 Root-Cause / Design Artifact

This is the durable forensic and design checkpoint for Change Unit
`CU-3.25A-BUG01-RERUN2`. It materializes the **revised** root-cause finding
produced in the current Native Agent conversation after operator
`ROOT_CAUSE_NEEDS_REVISION` closure.

It is **not** implementation authorization.

## 1. Authority / checkpoint status

| Field | Value |
| --- | --- |
| Checkpoint type | `ROOT_CAUSE` |
| Status | `WAITING_FOR_ROOT_CAUSE_OPERATOR_ACCEPTANCE` |
| Implementation authorized | `NO` |
| Product runtime source modified | `NO` |
| Finding generation | Revised closure pass (not the first incomplete RERUN2 freeze) |

Authoritative Product problem statement: original operator `BUG01.docx`.

Current Product workspace:
`C:\Projects\Negotiations AI\negotiations-web-stage-3-25a-bug01-rerun2`

Branch: `fix/stage-3-25a-bug01-rerun2`

## 2. Change Unit

`CU-3.25A-BUG01-RERUN2`

## 3. Baseline SHA

`0f35e6bc84650fdff28e0dbdbae2a1609e9d9b58`

Canonical baseline ref: `origin/deploy/yandex-poc`

## 4. Original BUG01 symptom and reported role/phase coverage

Original operator statement (authoritative):

During meeting `https://negotaitions.ru/room/cmtciv3s2000lyfm1jkp2mfpo`, when
an Observer saves notes during negotiation, saved notes sometimes remain
displayed as unsaved. This happens when text is inserted into the middle of
already written and saved text, for example by pressing Enter.

The same status defect was diagnosed for a Participant during preparation:
saved status does not always update correctly. A previous correction existed,
but the defect returned.

Required coverage:

- Observer during negotiation (room notes).
- Participant during preparation (join and/or room notes).

## 5. Proven root cause

```
BUG01_ROOT_CAUSE =
LF / CRLF semantic comparison mismatch across the browser multipart/server
FormData boundary.
```

React draft / `textarea.value` / client `FormData.get("notes")` keep HTML API
newlines as LF.

The same FormData is then sent as `multipart/form-data`. Chromium, Firefox,
and WebKit encode the field body with CRLF. Node `Request.formData()`
reconstruction (same Fetch class Next uses for server actions) returns that
CRLF string.

The server action persists and echoes `result.notes` unchanged.
`reconcileSavedNotes()` stores that CRLF echo as `savedBaseline`.
`areNotesDirty()` uses raw `draftNotes !== savedBaseline`.

Logically identical multiline text therefore stays **Unsaved**.

Architectural distinction that remains accepted:

- Lack of draft overwrite is **not** the root cause.
- Preserving the live draft is required for in-flight concurrency safety.
- Persistence semantics must remain unchanged.
- Newline canonicalization belongs to **client semantic comparison only**.

If `draftNotes === submittedNotes === result.notes`, advancing `savedBaseline`
already makes dirty false. The defect exists only because those strings are
not equal after a successful multiline save.

## 6. Concrete A–G boundary values

Proven example: `"line1" + Enter + "line2"`.

| | Boundary | Proven value |
| --- | --- | --- |
| A | React controlled draft / `event.target.value` | `"line1\nline2"` |
| B | DOM `textarea.value` immediately before submit | `"line1\nline2"` |
| C | Client wrapper `FormData.get("notes")` | `"line1\nline2"` |
| D | Server-reconstructed `formData.get("notes")` | `"line1\r\nline2"` |
| E | Persisted / `result.notes` | `"line1\r\nline2"` |
| F | `savedBaseline` after `reconcileSavedNotes()` | `"line1\r\nline2"` |
| G | Live `draftNotes` at the following dirty check | `"line1\nline2"` |

`C === A` is true. `D === C` is false. `G === F` is false.
Current `areNotesDirty(G, F)` is true.

Zod `saveParticipantNotesSchema.notes` is `z.string()` with no newline
transform. `persistParticipantNotesAfterAccess()` echoes `input.notes`.

## 7. Deterministic browser/server probe evidence

Read-only probes used TEMP HTML/scripts. Tracked Product files were not
modified.

1. Playwright Chromium, Firefox, and WebKit:
   `textarea.value` and `new FormData(form).get("notes")` both remained
   `"line1\nline2"` after mid-text Enter. Client FormData constructor is **not**
   the conversion site.
2. Same-origin `fetch` of that FormData as `multipart/form-data`:
   wire field body was `"line1\r\nline2"` in all three engines.
3. Node `Request.formData()` reconstruction of the Chromium multipart body:
   `get("notes")` was `"line1\r\nline2"`.

React 19 form actions construct `new FormData(form)` then Flight-copy entries
and `fetch` the FormData as multipart. That is the Product save path
(`ParticipantNotesPanel` / materials `NotesForm` →
`saveParticipantNotes` / `saveAccountParticipantNotes`).

## 8. Why Enter / mid-text newline reproduces the issue

Enter inserts an LF into the textarea API value. Single-line saves have no
newline, so A–G stay equal and `.fill("B")` tests pass.

Mid-text Enter is the first ordinary edit that creates an LF for multipart
encoding to turn into CRLF. Strict `!==` then treats the successful save as
unsaved.

## 9. Observer vs Participant common mechanism

Confirmed: **YES**. Same dirty-state helper and the same native form → server
action path.

- Observer during negotiation: `shared-room-shell.tsx` /
  `voximplant-room-sidebar.tsx` → `ParticipantNotesPanel`.
- Participant during preparation: `join-page-view.tsx` and/or room sidebar →
  same panel.
- Account materials (both roles): `NotesForm` in
  `account-session-materials-view.tsx` (duplicated wrapper, same kernel).

Auth entry differs (`joinToken` vs `participantId`). Dirty semantics do not.

## 10. Persistence implications

Persistence is a byte-preserving echo of the reconstructed server FormData
string. Storage is not corrupting user-visible note text.

**Persistence semantics must not change.** Do not LF-normalize notes in the
database, Prisma write, or action return unless a later operator decision
explicitly requires it.

## 11. Polling conclusion

Room sidebar polling (~1s) updates `initialNotes` props. `ParticipantNotesPanel`
does not sync `initialNotes` into `draftNotes` / `savedNotes` after mount.

Polling is **not** the primary BUG01 causal chain. The live-draft isolation
must remain so polling or a later save response cannot overwrite a newer
local draft.

## 12. In-flight edit concurrency invariant

Required concurrency semantic, **separate from root cause**:

A newer local edit made while an older save is in flight must remain visible,
untouched, and dirty.

`reconcileSavedNotes()` advancing only the baseline after success is the
correct concurrency protection. It must be kept.

## 13. Selected minimal fix direction

Client-only semantic comparison in `lib/participant-notes-state.ts`, consumed
by both UI wrappers:

```ts
function canonicalizeNotes(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function areNotesDirty(currentDraft: string, savedBaseline: string): boolean {
  return canonicalizeNotes(currentDraft) !== canonicalizeNotes(savedBaseline);
}
```

Keep `reconcileSavedNotes()` unchanged. Do not overwrite `draftNotes` on
success. Do not change DB notes bytes.

This is **not** implementation authorization. Implementation starts only after
explicit operator root-cause / fix-direction acceptance.

## 14. Rejected alternatives

### Post-save draft overwrite

`current === submittedNotes ? result.notes : current` is not the root-cause
fix.

On the client, `submittedNotes` (C) is LF. That replacement would copy CRLF
`result.notes` into the React draft. The next textarea `onChange` emits LF
again and false-dirty can return.

Draft overwrite is also the wrong layer for in-flight protection: live draft
must not be replaced by a save result when the user has typed further.

### Persistence normalization

LF-normalizing notes on the server would change persisted bytes and is
unnecessary. The stored string already matches transport reconstruction.
Existing CRLF rows would still compare dirty until rewritten unless the
client also canonicalizes.

### Client baseline divergence from server result

Setting `savedBaseline` from client C (LF) instead of `result.notes` (CRLF)
would make the UI baseline drift from DB encoding. Weaker than comparing both
sides canonically while keeping the server echo as persisted truth.

## 15. Canonicalization semantics

For **client semantic comparison only**:

- CRLF (`\r\n`) → LF (`\n`)
- CR (`\r`) → LF (`\n`)

Do not canonicalize persistence, action return, or AI/material note bytes as
part of BUG01.

## 16. Focused automated regression plan

Must include a regression that **fails on this baseline** for the proven
mismatch. Do not rely only on `.fill()` full replacement.

Unit (`lib/participant-notes-state.test.ts`):

- `areNotesDirty("line1\nline2", "line1\r\nline2")` is false after the fix
  (fails on current baseline).
- CR-only `"line1\rline2"` vs LF is false.
- Existing in-flight unit remains: a newer draft stays dirty against an older
  successful baseline, including when the baseline only differs by CRLF on the
  saved side and the newer draft has different text.

E2E:

- Actual mid-text insertion: place caret inside existing saved text,
  `press('Enter')`, Save → “Notes saved”, no “Unsaved notes”.
- Keep `tests/e2e/stage-3-13e-standalone-remediation.spec.ts` in-flight-edit
  coverage.

## 17. Mandatory Observer-during-negotiation coverage

Automated and UAT must exercise Observer notes in the live room during
negotiation (sidebar `ParticipantNotesPanel`), including mid-text Enter then
Save. Materials-only coverage is not a substitute.

## 18. Mandatory Participant-during-Preparation coverage

Automated and UAT must exercise Participant preparation notes (join page
and/or room/preparation notes using the same panel), including mid-text Enter
then Save.

## 19. UAT plan

| Role | Phase | Steps | Pass |
| --- | --- | --- | --- |
| Observer | Negotiation / room | Multiline notes; save; caret mid-text; Enter; save | “Notes saved”; no “Unsaved notes”; reload confirms persistence |
| Participant | Preparation | Same on preparation notes | Same |
| Either | After successful multiline save | Click into textarea without editing | Status stays Notes saved |
| Either | After that | Type a real extra character | Status becomes Unsaved notes |
| Either | Slow save | Edit while save is in flight | Newer text remains; status unsaved until that text is saved |

## 20. Complexity / risk

Complexity: **LOW**.

Risk: **LOW–MEDIUM**. Must preserve in-flight dirty semantics and must not
over-sync draft from polling, props, or save responses.

## 21. Remaining uncertainty

Low. Live Next.js Flight POST of this CU’s action was not captured; D was
proven with Node `Request.formData()` on a Chromium multipart body, which is
the same encoding React Flight then fetches. Prisma is a byte-preserving
echo.

## 22. Historical comparison (separated; does not rewrite the finding)

Independent revised finding was frozen **before** this comparison and is not
changed by it.

Comparison class recorded after freeze:

| Axis | Classification |
| --- | --- |
| ROOT-CAUSE LOCATION | `MATCH` |
| EXACT ROOT CAUSE | `MATCH after closure` |
| FIX DIRECTION | `MATCH` with the mature historical client-canonicalization design |

The first RERUN2 forensic pass was causally incomplete: it stopped at “baseline
advances, draft is not overwritten, dirty is `!==`” without proving why the
persisted/result string differed from the React draft.

The closure pass established the LF/CRLF boundary transformation independently
from current pristine Product source plus deterministic browser/Node probes.
Historical BUG01 worktrees were not used as engineering authority for the
finding.

Current-repo history visible without those worktrees: commit `281aba0`
introduced the draft/baseline split and in-flight protection, with E2E that
uses `.fill()` replacement and therefore could appear successful while the
multipart newline mismatch remained.

## 23. Product runtime bytes modified

`NO`

This artifact is forensic/planning documentation only. It does not change
runtime Product source.

## 24. Dogfood / model-routing observations (deferred governance)

Retain; do not repair in this CU. Deferred to governance/tooling alignment
after BUG01 and before BUG03.

| Item | Observed in RERUN2 |
| --- | --- |
| `CURSOR_WORKSPACE_SWITCH_BREAKS_CHAT_CONTINUITY` | YES — EO friction log / continue gate |
| `EO_USAGE_POLICY_NOT_EMBEDDED_IN_PRODUCT_REPO` | YES — EO friction log |
| `EO_BOOTSTRAP_EXCESSIVE_LATENCY` | Partial — continue latency observed; full bootstrap not re-measured here |
| `EO_RUNTIME_ARTIFACT_VISIBLE_IN_PRODUCT_WORKTREE` | YES — untracked `.eo/repository-profile.json` |
| `LEAN_RUNTIME_OUTPUT_EVENTS_NOT_PROJECTED` | Not directly observed (CLI JSON consumed by Agent) |
| `LEAN_RUNTIME_STATUS_NOT_PROJECTED` | Not directly observed |

Model routing for this investigation: Grok 4.6 High per Product
`docs/testing/agent-model-routing.md` and EO `resolvedModelId`
`grok-4.6[effort=high,fast=true]`.

## Affected current-state paths (for later implementation, not a change list)

- `lib/participant-notes-state.ts`
- `lib/participant-notes-state.test.ts`
- `components/participant-notes-panel.tsx`
- `components/account-session-materials-view.tsx` (`NotesForm`)
- `docs/architecture/04-session-event-flow.md` (dirty/baseline semantics; update
  only when implementation is authorized)

## Non-goals

- No Product runtime implementation in this checkpoint.
- No schema/migration.
- No notes persistence format change.
- No sidebar polling redesign.
- No EO/governance repair.
- No commit / release / deploy.

`WAITING_FOR_ROOT_CAUSE_OPERATOR_ACCEPTANCE`
