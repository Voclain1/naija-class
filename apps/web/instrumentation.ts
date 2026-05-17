// Next.js 15 instrumentation entrypoint. Called once per runtime
// (node/edge); dynamically imports the right Sentry config so the browser
// bundle doesn't ship server-side init code, and vice versa.
//
// register() is called by Next before user code runs — analogous to the
// API's main.ts pattern of init-before-app.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
