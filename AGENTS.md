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
