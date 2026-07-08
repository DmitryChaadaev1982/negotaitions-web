# Pause Filter Calibration (Local Only)

## Purpose

Stage 3.4.4 adds a local-only harness to calibrate pause-filter rules with real
pre-filter transcription segments captured from a local session.

This tooling is intended for controlled debugging runs and **does not change**
production pause-filter defaults.

## Safety Notes

- Calibration is disabled by default.
- Calibration only runs when explicitly enabled by env flags.
- Artifacts are written only under `.debug/pause-filter-calibration`.
- Artifacts can contain test speech text; keep them local and do not commit.

## Local Reverse SSH Tunnel Setup

Example flow (adapt to your host):

1. Start local app (`npm run dev`) on `localhost:3000`.
2. Create reverse SSH tunnel so remote endpoint points to local app:
   - `ssh -R 443:localhost:3000 <tunnel-host>`
3. Ensure your local domain routing resolves `https://local.negotaitions.ru` to the tunnel.
4. Open `https://local.negotaitions.ru` and run a real session.

## Required Env Flags

```bash
PAUSE_FILTER_CALIBRATION_ENABLED=1
PAUSE_FILTER_CALIBRATION_DIR=.debug/pause-filter-calibration
```

Optional marker and auto-run flags:

```bash
PAUSE_FILTER_CALIBRATION_ACTIVE_MARKERS="КАЛИБРОВКА АКТИВНАЯ ФРАЗА ОДИН|КАЛИБРОВКА АКТИВНАЯ ФРАЗА ДВА|КАЛИБРОВКА АКТИВНАЯ ФРАЗА ТРИ"
PAUSE_FILTER_CALIBRATION_PAUSED_MARKERS="КАЛИБРОВКА ПАУЗА ФРАЗА ОДИН|КАЛИБРОВКА ПАУЗА ФРАЗА ДВА"
PAUSE_FILTER_CALIBRATION_AUTO_RUN=1
```

Optional local override path (debug only):

```bash
PAUSE_FILTER_RULE_OVERRIDE_PATH=.debug/pause-filter-calibration/<sessionId>/recommended-rule.json
```

## Test Script (Marker Phrases)

Use clearly spoken marker phrases in three windows:

1. **Before PAUSE**: speak active markers.
2. **During PAUSE**: speak paused markers.
3. **After RESUME**: repeat active markers.

Run at least one full PAUSE/RESUME cycle and then FINISH the session.

## Calibration Command

After `raw-calibration-input.json` exists:

```bash
tsx scripts/pause-filter-calibrate-session.ts \
  --sessionId <sessionId> \
  --active "КАЛИБРОВКА АКТИВНАЯ ФРАЗА ОДИН|КАЛИБРОВКА АКТИВНАЯ ФРАЗА ДВА|КАЛИБРОВКА АКТИВНАЯ ФРАЗА ТРИ" \
  --paused "КАЛИБРОВКА ПАУЗА ФРАЗА ОДИН|КАЛИБРОВКА ПАУЗА ФРАЗА ДВА" \
  --input .debug/pause-filter-calibration/<sessionId>/raw-calibration-input.json \
  --out .debug/pause-filter-calibration
```

## Output Paths

For each session:

- `.debug/pause-filter-calibration/<sessionId>/raw-calibration-input.json`
- `.debug/pause-filter-calibration/<sessionId>/candidate-scoreboard.csv`
- `.debug/pause-filter-calibration/<sessionId>/candidate-scoreboard.json`
- `.debug/pause-filter-calibration/<sessionId>/segment-classification-table.csv`
- `.debug/pause-filter-calibration/<sessionId>/reconstructed-text-by-candidate.json`
- `.debug/pause-filter-calibration/<sessionId>/recommended-rule.json`
- `.debug/pause-filter-calibration/<sessionId>/calibration-report.md`

## Interpreting `recommended-rule.json`

- `inconclusive=true` means marker signal was insufficient in raw text.
- `recommendedRule=null` means no reliable candidate could be selected.
- `recommendedRule.candidateId` identifies family and parameter tuple.
- `confidence` is relative to candidate score separation.

Use recommendations as input for a later production patch review; do not apply
directly to production defaults.

## Production Behavior Warning

This stage does not alter production pause-filter defaults and does not modify
recording lifecycle, PAUSE/RESUME orchestration, or Voximplant scenario logic.
