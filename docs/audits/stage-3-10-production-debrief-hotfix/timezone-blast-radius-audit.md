# Timezone blast-radius audit

Classification legend:

- **A** Confirmed defect (contributed to incident or proven unsafe under Europe/Moscow)
- **B** Potential defect (same pattern / mixed clock domains; not proven in incident)
- **C** Safe — both operands `timestamp without time zone` UTC convention
- **D** Safe — JS `Date`/epoch arithmetic
- **E** Safe — relative milliseconds, not absolute timestamps

## Production application SQL / occupancy

| file | line (approx) | field / expression | feature | impact | class | fix | test |
|---|---|---|---|---|---|---|---|
| `lib/session-room-occupancy.ts` | pred. `expiresAt > …` | `SessionRoomConnection.expiresAt` vs clock | lease occupancy / finish lifecycle | false zero occupancy → CLOSED | **A** | `sqlUtcWallClockOrDate` | dual-TZ pg + occupancy unit |
| `lib/session-room-occupancy.ts` | close CAS `updatedAt = …` | `Session.updatedAt` | debrief auto-close | wrong wall-clock if bare NOW() | **A** (same class) | UTC wall helper / Date | updatedAt dual-TZ test |
| `lib/stage-3-10-maintenance.ts` | backfill verify EXISTS expiresAt | diagnostic count | maintenance verify | false positives/negatives | **A**/B | UTC wall SQL | covered by helper semantics |
| `lib/session-completion.ts` | Prisma `new Date()` writes | negotiationEndedAt / stop timestamps | finish + recording stop | UTC convention via Prisma | **D** | none | existing finish e2e |
| `lib/session-room-connection-lease.ts` | Prisma `expiresAt: withExpiry(now)` | lease expiry | presence leases | JS Date comparisons | **D** | none | presence e2e |
| `lib/stage-3-10-maintenance.ts` | `expiresAt: { lte: now }` | expiry sweep | lease expiry | Prisma Date filter | **D** | none | presence/expiry e2e |
| `lib/session-empty-room-reconciliation.ts` | grace via JS Dates | debrief grace | auto-close | epoch ms math | **D**/**E** | none | occupancy unit |
| `lib/session-room-occupancy-policy.ts` | graceRemainingMs | debrief grace | auto-close | relative ms | **E** | none | unit |
| `lib/negotiation-control.ts` | remaining seconds | auto-finish timer | negotiation timer | JS Date math | **D** | none | control unit/e2e |
| `lib/recording-stop-delivery-policy.ts` | nextRetryAt schedule | stop retry | recording stop | JS Date + ms | **D**/**E** | none | unit |
| `lib/voximplant/server-stop-*` | timeoutMs / nonce window | server-stop / replay | callbacks | relative ms + JS Date | **D**/**E** | none | unit |
| Prisma `@updatedAt` / `@default(now())` | all models | createdAt/updatedAt | telemetry/sorting | client usually sends JS Date | **D** (client path) | none | — |
| DB `DEFAULT CURRENT_TIMESTAMP` on createdAt | many tables | createdAt default | raw SQL inserts | session-TZ local wall into timestamp w/o tz | **B** | avoid raw inserts; long-term timestamptz | inventory only |
| E2E fixtures `NOW()` / `updatedAt=NOW()` | `tests/e2e/**` | seed/fixture clocks | tests | depend on e2e DB TZ | **B** (tests) | prefer UTC wall in lifecycle-critical fixtures later | not production |

## Feature impact matrix

| feature | assessment |
|---|---|
| session room leases (claim/renew via Prisma) | Safe (**D**); broken only when raw SQL used `NOW()` for occupancy |
| presence heartbeat | Safe (**D**) Prisma path |
| DEBRIEF_OPEN auto-close grace | Safe (**D**/**E**) once occupancy count is correct |
| lifecycle reconciliation | Was unsafe via occupancy count (**A**); fixed |
| pause intervals | Safe (**D**) JS/Prisma timestamps |
| negotiation auto-finish | Safe (**D**) JS remaining-seconds |
| recording stop timeout/retry | Safe (**D**/**E**) |
| callback nonce expiry | Safe (**D**) Prisma Date compares |
| transcription/AI timestamps | Mostly Prisma (**D**); raw fixture NOW in tests (**B**) |
| telemetry / sorting updatedAt | Prisma `@updatedAt` (**D**); raw `updatedAt=NOW()` in app was occupancy close (**A**, fixed) |
| cleanup / expiry sweep | Prisma `lte: now` (**D**) |

## Explicit non-goals this hotfix

- No mechanical replace of all `NOW()` in e2e seeds
- No `@db.Timestamptz` migration
- No change to DB `TimeZone` setting (app-level UTC wall helper is the minimal fix)
