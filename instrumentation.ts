/**
 * Next evaluates `instrumentation` for every server runtime, including Edge.
 * `process.env.NEXT_RUNTIME` is inlined per runtime compile, so keeping every
 * Node-only dependency inside a separate module behind this branch leaves the
 * Edge bundle free of `node:*` imports and `process.cwd()`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeInstrumentation } = await import("./lib/instrumentation/node-runtime");
    await registerNodeInstrumentation();
  }
}
