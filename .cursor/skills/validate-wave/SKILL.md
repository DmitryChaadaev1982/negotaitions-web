---
name: validate-wave
description: Thin wrapper that continues EO formal validation for a durable NegotAItions Change Unit. Focused local checks are Native work, not validate-wave.
---

# Validate-wave

Classification: **THIN_WRAPPER_TO_EO_FORMAL_VALIDATION**

This Skill is not a Product L1–L4 sequencer and not a nested Agent/subagent
validation state machine.

## Normal behavior

1. Require a durable EO Change Unit. If none exists, stop and start/resume
   through EO (`CONTINUE_CHANGE_UNIT` / `eo change-unit continue` /
   `stage-start`). Do not invent a competing validation workflow.
2. Continue EO formal validation for that CU. EO selects canonical gates from
   the Product profile (`validate:fast`, `validate:deploy`, `test:e2e:smoke`,
   `test:e2e:smoke:browser`).
3. UAT must already have passed. Do not run canonical formal validation as a
   substitute for UAT.
4. Do not manually rerun long canonical gates through nested Agent/subagent
   orchestration.

## Not validate-wave

Focused local checks during implementation are normal Native work. They are
not this Skill.

Product still owns the command implementations. This Skill does not delete
or replace `npm run validate:fast` / `validate:deploy` / smoke commands. It
does not decide the lifecycle moment those canonical gates run.

If EO blocks, report the EO block. Do not improvise a parallel ladder.
