import { beforeEach, describe, expect, it } from "vitest";

import {
  beginAuthForcedNavigation,
  consumeSessionEndReason,
  isAuthForcedNavigation,
  parkSessionEndReason,
  resetForTests,
} from "./session-end-navigation";

// The flag that stops a beforeunload guard offering a "Stay" it cannot honour.
//
// The behaviour under test is small, but the failure it prevents is not: a
// dirty gradebook, a revoked session, and a browser dialog whose "Stay" path
// unmounts the form anyway and redirects with no explanation.

beforeEach(() => {
  resetForTests();
});

describe("isAuthForcedNavigation", () => {
  it("is false by default — an ordinary page never suppresses its guard", () => {
    // The default matters more than it looks: getting it wrong would disable
    // every unsaved-changes warning in the app, including for a deliberate
    // tab close, which is the case the guards were written for.
    expect(isAuthForcedNavigation()).toBe(false);
  });

  it("is true once a forced sign-out has begun", () => {
    beginAuthForcedNavigation("expired");
    expect(isAuthForcedNavigation()).toBe(true);
  });

  it("is true even when the reason is unknown", () => {
    // An unrecognised 401 code still means the credential is gone, so "Stay"
    // is still a lie. Suppression must not depend on having copy to show.
    beginAuthForcedNavigation(null);
    expect(isAuthForcedNavigation()).toBe(true);
  });
});

describe("consumeSessionEndReason", () => {
  it("returns null before anything has happened", () => {
    // RequireAuth's guest branch also fires on a COLD load with no session.
    // A first-time visitor must be told nothing, not "your session expired".
    expect(consumeSessionEndReason()).toBeNull();
  });

  it("carries the reason so a redirect that cannot know it still explains", () => {
    beginAuthForcedNavigation("expired");
    expect(consumeSessionEndReason()).toBe("expired");
  });

  it("keeps every reason distinct — never collapses them to one message", () => {
    for (const reason of ["expired", "revoked", "deactivated"] as const) {
      resetForTests();
      beginAuthForcedNavigation(reason);
      expect(consumeSessionEndReason()).toBe(reason);
    }
  });

  it("survives repeated reads — it is not a one-shot queue", () => {
    // RequireAuth can re-render before the document is replaced; a second read
    // returning null would silently drop the explanation on the retry.
    beginAuthForcedNavigation("revoked");
    expect(consumeSessionEndReason()).toBe("revoked");
    expect(consumeSessionEndReason()).toBe("revoked");
  });

  it("is set by the hydration path too, WITHOUT silencing the unsaved-work guards", () => {
    // Cold-boot hydration learns why a session ended (GET /auth/me returns the
    // code) but does not navigate — it runs with notifyOnUnauthorized:false and
    // leaves the redirect to RequireAuth. It must park the reason, so a
    // deactivated teacher following a link is told why...
    parkSessionEndReason("deactivated");
    expect(consumeSessionEndReason()).toBe("deactivated");
    // ...and must NOT raise the forced-navigation flag, which would disable
    // every beforeunload guard in the document for the rest of its life.
    expect(isAuthForcedNavigation()).toBe(false);
  });

  it("keeps deactivated intact, so the login screen can refuse to promise a retry", () => {
    // sessionEndNotice("deactivated") is the only copy that does NOT say
    // "sign in again" — the server rejects that account at login too. Losing
    // this reason downgrades it to a generic screen that implies it would work.
    beginAuthForcedNavigation("deactivated");
    expect(consumeSessionEndReason()).toBe("deactivated");
  });
});
