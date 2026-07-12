<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Architecture documentation rule

- Before changing any feature area, inspect `docs/architecture/code-map.md`.
- If changed files map to an architecture doc, update that doc in the same change.
- If no doc change is needed, explain why in final response.
- For new feature areas, create or update a corresponding architecture doc.
- Do not add new major flows without updating `docs/architecture/README.md` and `docs/architecture/code-map.md`.

## Mandatory validation gates

For implementation changes (code/config/tests/runtime), run and report:

- `npm run validate:fast`
- `npm run validate:deploy`
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`

Rules:

- All four gates are mandatory unless the task is strictly audit-only or docs-only.
- If any gate cannot run, report the blocker explicitly; do not silently skip.
- `npm run test:e2e:full` is manual/nightly unless explicitly requested.
- Tunnel/live-provider suites are opt-in (`test:e2e:tunnel*`, `test:e2e:live*`) and are not default gates.
