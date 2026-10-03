"use client";

import { useState } from "react";

import type { ReleasedResultDetailDto } from "@school-kit/types";

// The PIN box on a locked term (Phase 8c / CP6b, D54). One redemption here
// unlocks this child's term everywhere — this portal, the app and the result
// checker — and takes one use of the card, once (D57).
//
// The tinted surface carries the state; the words carry it too (CLAUDE.md:
// never an accent border, never colour alone).
export function PinUnlockForm({
  unlockPath,
  onUnlocked,
}: {
  /** The proxied unlock endpoint for this child and term. */
  unlockPath: string;
  onUnlocked: (result: ReleasedResultDetailDto) => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!pin.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(unlockPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        onUnlocked(body as ReleasedResultDetailDto);
        return;
      }
      const error = (body as { error?: { message?: string } } | null)?.error;
      setMessage(error?.message ?? "That didn't work. Check the PIN and try again.");
    } catch {
      setMessage("We couldn't reach SchoolKit. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg bg-amber-50 p-5 text-amber-950" aria-labelledby="result-pin-heading">
      <h2 id="result-pin-heading" className="font-semibold">
        These results need a result PIN
      </h2>
      <p className="text-sm">
        Your school has released this term&apos;s results with result PIN cards. Enter the 12-digit PIN from the card.
        Once it works, the results stay open here and in the app.
      </p>
      <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="result-pin">
          Result PIN
        </label>
        <input
          id="result-pin"
          inputMode="numeric"
          autoComplete="off"
          placeholder="1234 5678 9012"
          className="h-10 w-56 rounded-md border bg-background px-3 font-mono text-base tracking-wider text-foreground"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || !pin.trim()}
          className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Checking…" : "Open results"}
        </button>
      </form>
      {message ? (
        <p role="alert" className="text-sm font-medium">
          {message}
        </p>
      ) : null}
    </section>
  );
}
