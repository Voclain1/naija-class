import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Phase 4 / Slice 2 — was an unconditional redirect to /login in slice 1
// (no auth existed yet). Now checks for the sk_portal_session cookie's
// PRESENCE only — not full validity (expired/revoked) — to decide whether
// to redirect. This is deliberately NOT a real auth check: verifying the
// session properly would need a GET /portal/me-style round trip through
// GuardianAuthGuard, which is out of scope for slice 2 (no protected
// dashboard content exists yet — that's slice 4's "parent view"). Worst
// case with a stale-but-present cookie: this placeholder renders instead of
// redirecting to /login, which reveals nothing since it has no real data.
export default async function RootPage() {
  const cookieStore = await cookies();
  const hasSession = Boolean(cookieStore.get("sk_portal_session")?.value);

  if (!hasSession) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re signed in</h1>
      <p className="text-sm text-muted-foreground">
        The parent dashboard isn&apos;t built yet — that&apos;s a later slice.
      </p>
    </main>
  );
}
