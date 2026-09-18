# Stage 3.22A — Next/React Critical Runtime Security Patch

## Authority

This is the authoritative requirement/change-plan manifest for Stage 3.22A
CP1 (exact Next/React pins + targeted sanity + UI operator checkpoint).
Architecture, privacy, access, database, operations, and existing validation
ladder documents remain the domain/safety authorities.

Status values: `APPROVED`, `IMPLEMENTED`, `DEFERRED`, `OUT_OF_SCOPE`, `PASS`,
`READY`.

```
STAGE_ID = 3.22A
STAGE_NAME = Next/React Critical Runtime Security Patch
STAGE_KIND = dependency / runtime security
PRODUCT_BEHAVIOR_CHANGE = FRAMEWORK_ONLY (AVIF optimizer disable; no product source rewrite)
CHECKPOINT = CP1 UI Operator Checkpoint
CP0 = PASS
CP1 = READY (stop before broad validation)
```

Do not treat `npm audit` as proof that these vendor advisories are fixed.
They are vendor-advisory findings. npm audit may not surface the
Next-bundled RSC / image-optimizer path.

## Change Impact Analysis (CP1)

```
CHANGE: Exact-pin next 16.3.0→16.3.3 and react/react-dom 19.2.4→19.2.8
        for current vendor security advisories on the installed runtime line.
INVARIANTS: No other direct dependency move; Prisma trio 7.10.0; no
            deepmerge-ts override; no AVIF re-enable; no custom image
            loader; Server Actions unchanged; no DB/ENV/product rewrite;
            Node engines remain >=20.9.0; no commit/push/deploy in CP1.
IMPACT: package.json, package-lock.json, Next image/RSC runtime,
        docs/requirements, current-state architecture pins
UNITS: CU-D exact Next/React security pins + lock forensic + targeted
       sanity + docs
KERNEL: CU-D runtime versions
EVAL: installed version artifacts; lock classification; existing focused
      image-helper and Server Action origin/auth helper tests; read-only
      npm audit (separated from vendor advisories); git diff --check
STRATEGY: A — one security-release line; split would hide lock forensics
VALIDATION_PLAN: L1 targeted only. validate:fast / validate:build /
                 validate:deploy / L4 NOT_RUN until UI operator acceptance.
```

## Security contract

### Next

| Field | Value |
| --- | --- |
| Current (pre-CP1) | `16.3.0` |
| Target / installed | `16.3.3` |
| Vendor security release | August 25, 2026 |
| Node engines after pin | `>=20.9.0` (unchanged) |

**N1 — `GHSA-2xp9-vwfh-vxw4`**

- Severity: Critical
- Area: Next Image Optimization / AVIF
- Affected: Next `<16.3.3`
- Patched: `16.3.3`
- Status: `PATCHED_BY_NEXT_16_3_3`
- Behavioral note: the security release disables AVIF optimization while the
  underlying libheif issue is addressed. Expected security behavior takes
  precedence. Do not re-enable AVIF, add a custom image loader, or pin a
  different sharp/libheif to restore AVIF.

**N2 — `GHSA-p293-qw3h-jr36`**

- Severity: Critical
- Area: Windows-hosted RCE
- Affected: Next `>=16.0 <16.3.3`
- Patched: `16.3.3`
- Status: `PATCHED_BY_NEXT_16_3_3`
- Production reachability: Yandex production is Linux, so the Windows-only
  path is not production-reachable. The upgrade remains required because
  `16.3.3` is the security release and local Windows environments also exist.

### React / RSC

**R1 — `GHSA-wx67-qw84-cm4g` / `CVE-2026-44907`**

- Severity: High
- Area: RSC / Server Functions DoS
- Affected: `react-server-dom` `19.2.0` through `19.2.7`
- Patched line: `19.2.8`
- Status: `PATCHED_LINE_19_2_8`
- Repo fact: the app uses Server Actions / RSC-capable Next App Router
  (`app/actions/**`, `next.config.ts` `experimental.serverActions`).
- Package representation: `react-server-dom-webpack` and
  `react-server-dom-turbopack` are **not** separately installed npm packages
  and do not appear in `package-lock.json`. Next vendors them as
  `react-server-dom-*-builtin` under `next/dist/compiled/`. Those compiled
  manifests do not publish a standalone npm version field. Do not manufacture
  a package-version proof for the vendored path. The installable proof is
  `react@19.2.8`, `react-dom@19.2.8`, and `next@16.3.3`.

## Explicit non-scope (CP1)

| ID | Requirement | Status |
| --- | --- | --- |
| S322A-NS-001 | Do not update `eslint-config-next` (`16.2.9`) or `eslint`. Alignment is desirable but not the production security kernel. | `OUT_OF_SCOPE` |
| S322A-NS-002 | Do not update Tailwind / `@tailwindcss/postcss`. Moved to Stage 3.22B. | `DEFERRED` |
| S322A-NS-003 | Do not update Prisma (`7.10.0`) or add `overrides.deepmerge-ts`. Residual Prisma finding is build/deploy-only; no released Prisma 7 upstream repair. | `DEFERRED` |
| S322A-NS-004 | Do not update Voximplant packages, tsx, Playwright, pg, OpenAI, AWS, LiveKit, TypeScript, Node, npm, `@types/node`, or nanoid. | `OUT_OF_SCOPE` |
| S322A-NS-005 | No generic dependency cleanup, `npm update`, `npm audit fix`, or `@latest` installs. | `OUT_OF_SCOPE` |
| S322A-NS-006 | No product source rewrite unless an exact patch compatibility blocker is proven. | `OUT_OF_SCOPE` |
| S322A-NS-007 | No DB / migration / ENV change. | `OUT_OF_SCOPE` |
| S322A-NS-008 | No commit, push, or deploy in CP1. | `OUT_OF_SCOPE` |
| S322A-NS-009 | No `validate:fast`, `validate:build`, `validate:deploy`, full unit, broad Playwright, L4, or eval-registry package before UI acceptance. | `OUT_OF_SCOPE` |

## Approved CP1 requirements

| ID | Requirement | Status |
| --- | --- | --- |
| S322A-D-001 | Exact-pin `next@16.3.3`, `react@19.2.8`, `react-dom@19.2.8` only. | `IMPLEMENTED` |
| S322A-D-002 | Installed artifacts match those versions; no prerelease. | `IMPLEMENTED` |
| S322A-D-003 | Lockfile movements limited to the Next 16.3.3 / React 19.2.8 graph and compatible framework transitives. | `IMPLEMENTED` |
| S322A-D-004 | Record N1 / N2 / R1 security targets and the npm-audit distinction. | `IMPLEMENTED` |
| S322A-D-005 | Confirm no product AVIF-output requirement; do not restore AVIF. | `IMPLEMENTED` |
| S322A-D-006 | Audit existing Server Action paths for obvious patch-line incompatibility; do not rewrite them. | `IMPLEMENTED` |
| S322A-D-007 | Run only targeted sanity, then stop for UI operator inspection. | `READY` |

## CP1 evidence

### Exact direct package changes

| Package | Before | After |
| --- | --- | --- |
| `next` | `16.3.0` | `16.3.3` |
| `react` | `19.2.4` | `19.2.8` |
| `react-dom` | `19.2.4` | `19.2.8` |

Prisma trio remains `@prisma/adapter-pg` / `@prisma/client` / `prisma` `7.10.0`.

### Lockfile classification

**DIRECT_MOVEMENTS**

- `next` `16.3.0` → `16.3.3`
- `react` `19.2.4` → `19.2.8`
- `react-dom` `19.2.4` → `19.2.8`

**TRANSITIVE_MOVEMENTS**

- `@next/env` `16.3.0` → `16.3.3`
- `@swc/helpers` `0.5.15` → `0.5.23` (Next 16.3.3 dependency)

**OPTIONAL_NATIVE_MOVEMENTS**

- `@next/swc-darwin-arm64`
- `@next/swc-darwin-x64`
- `@next/swc-linux-arm64-gnu`
- `@next/swc-linux-arm64-musl`
- `@next/swc-linux-x64-gnu`
- `@next/swc-linux-x64-musl`
- `@next/swc-win32-arm64-msvc`
- `@next/swc-win32-x64-msvc`

All `16.3.0` → `16.3.3`. `sharp` remains `0.35.3`. No libheif package is
represented in the npm graph.

**PEER_RESOLUTION_MOVEMENTS**

- `react-dom` peer `react` `^19.2.4` → `^19.2.8`
- Existing consumers (`next`, `@livekit/components-react`, Prisma Studio
  transitives) dedupe to the same `react@19.2.8` / `react-dom@19.2.8`. No
  new peer packages were added.

### Sharp / image stack

- `sharp@0.35.3` remains Next's optional native optimizer.
- No `libheif` / `*heif*` npm package is installed or lockfile-listed.
- `next.config.ts` has no `images` override, custom loader, or
  `unoptimized: true`. Optimizer stays enabled; AVIF output is a
  framework-disabled format after `16.3.3`.
- Current public sources are local JPG/PNG (`lib/public-site/visuals.ts`,
  `public/images/**`). Dashboard pictograms are local SVG/PNG via
  `next/image`. No code requires AVIF output.

### Server Action compatibility

Existing `"use server"` modules (unchanged):

- `app/actions/auth.ts` (`registerUser`, `loginUser`, locale)
- `app/actions/cases.ts`, `sessions.ts`, `events.ts`
- `app/actions/account.ts`, `password-reset.ts`, `legal-release.ts`
- `app/actions/admin-users.ts`, `session-sound-preference.ts`
- `app/actions/voximplant-recording-webhook.ts`

`next.config.ts` still wires `experimental.serverActions.allowedOrigins`
through `resolveServerActionAllowedOriginsFromEnv`. No patch-line API
breakage was observed. Actions were not rewritten.

### Targeted sanity

- Installed `node_modules/{next,react,react-dom}/package.json` versions
  match the pins. Next engines remain `node: >=20.9.0`.
- `npm ls next react react-dom sharp`
- Focused existing tests, all pass (26):
  - `lib/public-site/visuals.test.ts`
  - `lib/object-pictograms.test.ts`
  - `lib/object-pictogram-component.test.ts`
  - `lib/config/server-action-origins.test.ts`
  - `lib/auth/return-url.test.ts`
  - `lib/auth/password-reset-core.test.ts`
- `git diff --check` PASS
- Read-only `npm audit` / `npm audit --omit=dev` (no fix)

### NPM_AUDIT_FINDINGS (not the vendor proof)

These counts may remain after CU-D and do **not** mean the Next/React
vendor update failed.

| Scan | Count | Notes |
| --- | --- | --- |
| Full `npm audit` | 13 (2 moderate, 9 high, 2 critical) | Includes Tailwind/PostCSS, Vox CI/axios/form-data, nanoid, Prisma `deepmerge-ts`, and other deferred/dev graph items |
| Prod-only `npm audit --omit=dev` | 3 high | `@prisma/config` → `deepmerge-ts`; `prisma` → `@prisma/config` |

### VENDOR_SECURITY_ADVISORIES_FIXED_BY_VERSION

| ID | Status |
| --- | --- |
| N1 `GHSA-2xp9-vwfh-vxw4` | `PATCHED_BY_NEXT_16_3_3` |
| N2 `GHSA-p293-qw3h-jr36` | `PATCHED_BY_NEXT_16_3_3` |
| R1 `GHSA-wx67-qw84-cm4g` / `CVE-2026-44907` | `PATCHED_LINE_19_2_8` |

## Deferred to Stage 3.22B

- Tailwind / PostCSS
- ESLint / `eslint-config-next` alignment (`16.2.9` → later Next line)
- Vox tool isolation / accepted risk
- Prisma `deepmerge-ts` residual (no consumer major override in this hotfix)
- Other maintenance updates listed in explicit non-scope

## UI operator checklist (mandatory stop)

Broad validation is not authorized until the operator accepts this
checkpoint locally.

| ID | Check |
| --- | --- |
| UI-01 | Public landing renders correctly. |
| UI-02 | Login page renders correctly. |
| UI-03 | Authenticated Dashboard renders with normal app chrome/styles. |
| UI-04 | Representative Next/Image-based images render successfully. |
| UI-05 | Browser Network shows no failed `/_next/image` requests during inspected pages. |
| UI-06 | No obvious image-quality/layout regression from AVIF security behavior. |
| UI-07 | Open an existing Session/Event page successfully. |
| UI-08 | Perform one safe representative Server Action / DB-backed create or update using normal UI. |
| UI-09 | No React hydration/runtime error in browser console. |
| UI-10 | No new 500/server-action failure in Network. |

Do not require Vox/media/session recording in this checkpoint.

## Stop / authorization

```
validate:fast = NOT_RUN
validate:build = NOT_RUN
validate:deploy = NOT_RUN
COMMIT = NOT_AUTHORIZED
PUSH = NOT_AUTHORIZED
DEPLOY = NOT_AUTHORIZED
FINAL_STATUS = STAGE_3_22A_UI_OPERATOR_CHECKPOINT_READY
```
