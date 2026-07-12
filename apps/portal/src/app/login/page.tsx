// Slice 1 — static shell only. No submit handler, no client-side state, no
// API call. Real authentication (guardian session, form validation) is
// Phase 4 slice 2 — see docs/modules/phase-4.md §7 D1.
export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">School Kit</h1>
        <p className="text-sm text-muted-foreground">Parent Portal</p>
      </div>

      <form className="flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            disabled
            placeholder="you@example.com"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            disabled
            placeholder="••••••••"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <button
          type="button"
          disabled
          className="h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Log in
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Login is not wired up yet — this is the Phase 4 slice 1 scaffold.
        </p>
      </form>
    </main>
  );
}
