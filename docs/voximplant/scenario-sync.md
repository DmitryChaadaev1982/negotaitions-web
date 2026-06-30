# Voximplant Scenario Sync — Stage 5.4.9

Automated workflow for packaging, uploading, and verifying the VoxEngine scenario.

---

## Background

Manual copying of `docs/voximplant/neg-conf.main-room.scenario.js` into Voximplant Console
is error-prone. Voximplant supports VoxEngine CI via `@voximplant/voxengine-ci` for managing
applications, rules, and scenarios from a local environment or CI pipeline.

---

## 1. Install

```bash
npm install
```

`@voximplant/voxengine-ci` is already listed as a `devDependency`.

---

## 2. Required env vars

Add the following to `.env.local` (never commit this file):

```env
# Absolute path to your Voximplant service account JSON
# Download from: Voximplant Console → API keys → Create new key
VOX_CI_CREDENTIALS=C:\Projects\Negotiations AI\secrets\voximplant-negotaitions-service-account.json

# Local folder for generated VoxEngine CI staging files (absolute or relative to project root)
VOX_CI_ROOT_PATH=.voxengine-ci

# Short application name — used as the --application-name CLI argument for voxengine-ci upload
VOXIMPLANT_APPLICATION_NAME=negotaitions-video-poc

# Full application domain — used as the canonical folder name under VOX_CI_ROOT_PATH/applications/
# VoxEngine CI stores files under this full domain name, not the short name.
# If not set, derived from VOXIMPLANT_APPLICATION_NAME + VOXIMPLANT_ACCOUNT_NAME + ".voximplant.com"
VOXIMPLANT_APPLICATION_DOMAIN=negotaitions-video-poc.dvchaadaev.voximplant.com

# Scenario name as it will appear in Voximplant Console
VOXIMPLANT_SCENARIO_NAME=neg-conf-main-room

# Rule name as it appears in Voximplant Console
VOXIMPLANT_RULE_NAME=negotaitions-negotiation-room-rule
```

### Why two application variables?

`@voximplant/voxengine-ci` uses **different identifiers** for two things:

| Purpose | Value | Env var |
|---------|-------|---------|
| CLI `--application-name` flag | `negotaitions-video-poc` | `VOXIMPLANT_APPLICATION_NAME` |
| Folder inside `VOX_CI_ROOT_PATH/applications/` | `negotaitions-video-poc.dvchaadaev.voximplant.com` | `VOXIMPLANT_APPLICATION_DOMAIN` |

If you use the short name as the folder, `voxengine-ci upload` will fail with:  
`Rule with --rule-name "..." does not exist`  
because it looks in the domain-named folder.

**`VOX_CI_CREDENTIALS` is never logged or committed.**

The service account JSON must be kept outside the project directory, or in a path
that matches the `.gitignore` patterns: `*voximplant*service-account*.json`,
`*voximplant*credentials*.json`, `*-private.json`.

---

## 3. Prepare (package local scenario)

```bash
npm run vox:scenario:prepare
```

This runs `scripts/voximplant-sync-scenario.mjs` which:

1. Reads `docs/voximplant/neg-conf.main-room.scenario.js`.
2. Generates a **build ID** from git short SHA + timestamp:
   ```
   dev-20260630-131500-gabcdef1
   ```
3. Replaces `__LOCAL_DEV_BUILD__` in the scenario source with the build ID.
4. Writes the stamped scenario to the **authoritative root source folder**:
   ```
   .voxengine-ci/scenarios/src/neg-conf-main-room.voxengine.js
   ```
5. Writes canonical app metadata to:
   ```
   .voxengine-ci/applications/negotaitions-video-poc.dvchaadaev.voximplant.com/rules.config.json
   .voxengine-ci/applications/negotaitions-video-poc.dvchaadaev.voximplant.com/application.config.json
   ```
6. Optionally writes mirror scenario copies under app folders for compatibility/debugging:
   ```
   .voxengine-ci/applications/negotaitions-video-poc.dvchaadaev.voximplant.com/scenarios/src/neg-conf-main-room.voxengine.js
   .voxengine-ci/applications/negotaitions-video-poc/scenarios/src/neg-conf-main-room.voxengine.js
   ```
7. Merges with any existing `application.config.json` to preserve platform fields.
8. Writes `.vox-scenario-build-id` (gitignored, machine-local) for use by the diagnostics panel.
9. Prints build ID + SHA256 and all key paths. No secrets are printed.

---

## 4. Dry run (preview without uploading)

```bash
npm run vox:scenario:dry-run
```

Runs the prepare step and prints the upload command that would be executed, but does not
contact Voximplant servers.

---

## 5. Upload

```bash
npm run vox:scenario:upload
```

This runs `scripts/voximplant-upload-scenario.mjs` which:

1. Runs prepare (stamps build ID, generates canonical + mirror VoxEngine CI structure).
2. **Pre-upload validation** — fails early if:
   - Canonical `rules.config.json` is missing
   - Root scenario source `.voxengine.js` file is missing
   - `VOXIMPLANT_RULE_NAME` is not found inside `rules.config.json`
3. Invokes:
   ```
   npx voxengine-ci upload \
     --application-name <VOXIMPLANT_APPLICATION_NAME> \
     --rule-name <VOXIMPLANT_RULE_NAME>
   ```
   using `child_process.spawn` for Windows/PowerShell compatibility.
4. Sets `VOX_CI_ROOT_PATH` and `VOX_CI_CREDENTIALS` in the subprocess environment — neither value is printed.

### When CI upload fails with TS5042

If `voxengine-ci upload` fails during scenario build with:

```
TS5042: Option 'project' cannot be mixed with source files on a command line.
```

use the direct Management API fallback:

```bash
npm run vox:scenario:upload:direct
```

`vox:scenario:upload:direct`:

1. Reads `docs/voximplant/neg-conf.main-room.scenario.js`
2. Stamps `SCENARIO_BUILD_ID` with the same Stage 5.4.9 format:
   `dev-YYYYMMDD-HHMMSS-g<gitShortSha>`
3. Uploads scenario body via `SetScenarioInfo`
4. Prints `buildId`, `sha256`, `scriptSizeBytes`, and expected runtime log marker

Important:

- Direct upload updates **scenario body only**.
- It does **not** change routing rules.
- Rule must already point to `neg-conf-main-room`.
- Existing VoxEngine sessions do not pick up new code mid-session — always start a new session after upload.
- No credentials, private keys, JWTs, webhook secrets, or credential paths are printed.

---

## 6. Check drift

```bash
npm run vox:scenario:check
```

Compares the local generated scenario hash against a downloaded platform snapshot.
Local hash source is authoritative root source:
`.voxengine-ci/scenarios/src/<scenario>.voxengine.js`

Possible results:

| Result | Meaning |
|--------|---------|
| `LOCAL_ONLY` | No remote snapshot downloaded yet — drift cannot be checked |
| `MATCH` | Local and remote hashes match — scenario is in sync |
| `DIFF` | Hashes differ — local was changed after last upload |

To download a remote snapshot for comparison:

```bash
npx voxengine-ci init --force
```

(requires `VOX_CI_CREDENTIALS` to be set)

**Note:** Drift detection is best-effort. If no remote snapshot is available,
the result is `LOCAL_ONLY` with exit code 0. Drift checking via hash comparison
depends on `voxengine-ci init` placing the remote file in a path the script
knows about. The authoritative confirmation is the runtime build ID in Voximplant logs
(see section 7).

---

## 7. Verify runtime after upload

After uploading, **always create a new conference session** (existing running VoxEngine
sessions do not switch scenario code mid-session).

Then check Voximplant server logs for:

```
[neg-conf-prod] scenario build=dev-20260630-131500-gabcdef1 source=neg-conf-main-room
```

The build ID must match the value printed during `vox:scenario:prepare`.

The **recording diagnostics panel** (enabled via `NEXT_PUBLIC_RECORDING_DEBUG_PANEL=true`)
shows the expected build ID in the **"1b. Scenario Sync"** section and provides a
"Copy expected log marker" button.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `The "scenarios\\src\\...\\.voxengine" scenario does not exist` | Scenario source was written only under `applications/.../scenarios/src` | Ensure prepare writes `.voxengine-ci/scenarios/src/<scenario>.voxengine.js` |
| `Rule with --rule-name "..." does not exist` | App rules folder mismatch (short vs domain folder) | Set `VOXIMPLANT_APPLICATION_DOMAIN=negotaitions-video-poc.dvchaadaev.voximplant.com` |
| Logs show `Loading scenario neg-conf` | Rule still points to old scenario name | Re-upload and verify rule binding in Voximplant Console |
| Logs show `[neg-conf-rec]` | Old recording-only scenario is running | Rule is pointing to old scenario; check Console → Rules |
| No `[neg-conf-prod] scenario build=` line | Upload or rule binding failed | Run upload, check rule points to `neg-conf-main-room` |
| `VOX_CI_CREDENTIALS file not found` | Wrong path in `.env.local` | Download service account JSON from Voximplant Console → API keys |
| Pre-upload validation fails | `prepare` not run yet, or DOMAIN wrong | Run `npm run vox:scenario:prepare` first, check `VOXIMPLANT_APPLICATION_DOMAIN` |

---

## 9. Security notes

- `VOX_CI_CREDENTIALS` is never printed or logged by any script in this project.
- The build ID contains only: `dev-`, date, time, and git short SHA — no secrets.
- `.vox-scenario-build-id` is gitignored and contains only the build ID string.
- The `voxengine-ci/` staging directory is gitignored. It contains the scenario source
  (which is also in `docs/voximplant/`) plus generated config — no credentials.
- The `WEBHOOK_SECRET` hardcoded in the scenario source is already in `docs/voximplant/`
  which is committed. This is a known limitation: VoxEngine scenarios cannot use runtime
  env injection in all versions. Rotate the secret in `.env.local` and in the scenario
  file together.

---

## 10. Quick reference

```bash
# One-time: download voxengine-ci into devDependencies (already done)
npm install

# Generate local staging files + stamp build ID
npm run vox:scenario:prepare

# Dry run (no upload)
npm run vox:scenario:dry-run

# Prepare + upload
npm run vox:scenario:upload

# Direct fallback upload (bypasses voxengine-ci TS build)
npm run vox:scenario:upload:direct

# Compare local vs remote snapshot
npm run vox:scenario:check
```
