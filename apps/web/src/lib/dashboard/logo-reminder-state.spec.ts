import { describe, expect, it } from "vitest";

import { dismissReminder, noteSession, REMIND_AFTER_SESSIONS, shouldRemind } from "./logo-reminder-state";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("logo reminder: closable, back after a few sessions", () => {
  it("shows until closed, then stays away for the next sessions and comes back", () => {
    const local = memory();
    let session = memory();
    expect(shouldRemind(noteSession(local, session, "s1"))).toBe(true);

    dismissReminder(local, "s1");
    // Opening the dashboard again in the same sitting does not count.
    expect(shouldRemind(noteSession(local, session, "s1"))).toBe(false);

    for (let i = 1; i < REMIND_AFTER_SESSIONS; i++) {
      session = memory();
      expect(shouldRemind(noteSession(local, session, "s1"))).toBe(false);
    }
    session = memory();
    expect(shouldRemind(noteSession(local, session, "s1"))).toBe(true);
  });

  it("keeps each school separate", () => {
    const local = memory();
    const session = memory();
    noteSession(local, session, "s1");
    dismissReminder(local, "s1");
    expect(shouldRemind(noteSession(local, session, "s2"))).toBe(true);
  });

  it("still shows when storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(shouldRemind(noteSession(broken, broken, "s1"))).toBe(true);
    expect(() => dismissReminder(broken, "s1")).not.toThrow();
  });
});
