# Production canary plan

**Status: historical / executed.** This document is the original canary plan that was already carried out after the Stage 3.10 debrief hotfix deploy. It is retained for audit traceability; do not treat the preconditions or “awaiting approval” wording as current open work.

**Final result:** [production-canary-result.md](./production-canary-result.md) — Stage 3.10 production canary **PASS**, production status **GO**.

---

## Preconditions

*(As written at plan time; subsequently satisfied.)*

- Secrets sync `--check`: all four Voximplant secrets MATCH (already true)
- Hotfix merged to `deploy/yandex-poc` and service restarted after build
- No production SQL writes during canary setup beyond normal app traffic

## Manual setup

1. Create one Event session with facilitator + ≥2 participants (real browsers)
2. Short recording
3. Before FINISH, read-only capture:
   - Session `negotiationState`, `roomLifecycle`
   - active connection count using UTC-wall predicate
   - connection `expiresAt`
   - control channel + callback nonce presence

## FINISH checks

1. POST `/control` → 200
2. Journal log `canonical_session_finish_decision`:
   - `activeConnectionCount > 0`
   - `nextLifecycle=DEBRIEF_OPEN`
3. DB: `FINISHED` + `DEBRIEF_OPEN`
4. All clients stay in room; control-state 200; ALLOW_DEBRIEF UX
5. Server-stop callback HTTP 200; control channel + nonce rows exist
6. Stop operation transport/command/terminal timestamps filled; transport = server-control path when successful
7. Recording stops without waiting for AppEvents.Terminating alone
8. While any valid connection remains → stays `DEBRIEF_OPEN`
9. After last leave/expiry: <30s stays DEBRIEF_OPEN; after grace → CLOSED
10. After CLOSED → materials; transcription once

## GO / NO-GO

- **GO**: steps 1–4 and 8 mandatory; 5–7 for server-stop path; 9–10 for close path
- **NO-GO**: any immediate CLOSED with activeCount log >0 mismatch, or control-state 409 right after finish while connections valid

## Rollback (branch-aware, non-destructive)

Do **not** `git checkout <sha>` on production: that leaves the repo in detached HEAD. Use a named rollback branch from the pre-hotfix commit (explicitly approved), then build and restart.

```bash
set -euo pipefail

cd /var/www/negotaitions/app-git

test -z "$(git status --porcelain)" || {
  echo "ERROR: production worktree is dirty"
  exit 1
}

git fetch origin --prune

PRE_HOTFIX_SHA="3647593a61f3f6d132183622708c1c34d43e0614"
ROLLBACK_BRANCH="rollback/stage310-debrief-hotfix-$(date +%Y%m%d-%H%M%S)"

git switch -c "$ROLLBACK_BRANCH" "$PRE_HOTFIX_SHA"

npm ci
npm run build
sudo systemctl restart negotaitions-poc

systemctl is-active negotaitions-poc
curl -fsS --max-time 15 \
  -o /dev/null \
  -w 'PUBLIC /login HTTP %{http_code}\n' \
  https://negotaitions.ru/login

git branch --show-current
git rev-parse HEAD
```

(Use the pre-hotfix release commit above, or another known-good deploy commit explicitly approved. Do not leave production on detached HEAD.)

### Recovery back to `deploy/yandex-poc`

After an approved rollback, return production to the current deploy branch without detached HEAD (clean worktree required; no `reset --hard`):

```bash
set -euo pipefail

cd /var/www/negotaitions/app-git

test -z "$(git status --porcelain)" || {
  echo "ERROR: production worktree is dirty"
  exit 1
}

git fetch origin --prune
git switch deploy/yandex-poc
git pull --ff-only origin deploy/yandex-poc

npm ci
npm run build
sudo systemctl restart negotaitions-poc

systemctl is-active negotaitions-poc
curl -fsS --max-time 15 \
  -o /dev/null \
  -w 'PUBLIC /login HTTP %{http_code}\n' \
  https://negotaitions.ru/login

git branch --show-current
git rev-parse HEAD
```

## Final canary outcome

Executed against release `3a487713b521f785e6c81d15c776765e9f15cd61` (session `cms6njs0m000t6nm171at227c`).

- Result: **PASS**
- Production status: **GO**
- Plan steps 1–10 satisfied (lifecycle, debrief re-entry, grace auto-close, server-control stop, recording + transcription)

Details: [production-canary-result.md](./production-canary-result.md). Historical pre-hotfix failure evidence remains in [production-evidence.md](./production-evidence.md).
