import { describe, expect, it } from "vitest";

import {
  buildLoginUrl,
  isSafeNextPath,
  parseSessionEndReason,
  reasonFromErrorCode,
  resolveNextPath,
  sessionEndNotice,
} from "./session-end";

// F-10 regression suite.
//
// The security half of this file (isSafeNextPath / buildLoginUrl) is the part
// that must never regress quietly: a `next` parameter that accepts an
// external origin is an open redirect on the login page, which is the single
// worst place to have one — it fires at the exact moment the user has just
// proved they trust the app.

describe("reasonFromErrorCode — the server already distinguishes these", () => {
  it("maps each 401 code AuthGuard actually emits", () => {
    expect(reasonFromErrorCode("SESSION_EXPIRED")).toBe("expired");
    expect(reasonFromErrorCode("INVALID_SESSION")).toBe("revoked");
    expect(reasonFromErrorCode("USER_INACTIVE")).toBe("deactivated");
    expect(reasonFromErrorCode("MISSING_BEARER_TOKEN")).toBe("revoked");
  });

  it("returns null for anything it does not recognise, rather than guessing", () => {
    // Asserting a reason we cannot stand behind is worse than staying quiet:
    // "your session expired" is a factual claim about what happened.
    expect(reasonFromErrorCode("INVALID_CREDENTIALS")).toBeNull();
    expect(reasonFromErrorCode("SOMETHING_NEW")).toBeNull();
    expect(reasonFromErrorCode(undefined)).toBeNull();
  });

  it("never conflates expiry with revocation", () => {
    expect(reasonFromErrorCode("SESSION_EXPIRED")).not.toBe(
      reasonFromErrorCode("INVALID_SESSION"),
    );
  });
});

describe("sessionEndNotice — copy", () => {
  it("explains an expiry in plain language", () => {
    const notice = sessionEndNotice("expired")!;
    expect(notice.title).toBe("Your session expired");
    expect(notice.body).toMatch(/sign in again/i);
  });

  it("describes revocation as being signed out, NOT as a timeout", () => {
    const notice = sessionEndNotice("revoked")!;
    expect(notice.title).toBe("You were signed out");
    expect(notice.title).not.toMatch(/expired/i);
    expect(notice.body).not.toMatch(/expired/i);
  });

  it("does not tell a deactivated user that signing in again will help", () => {
    const notice = sessionEndNotice("deactivated")!;
    expect(notice.body).toMatch(/administrator/i);
    expect(notice.body).not.toMatch(/sign in again/i);
    expect(notice.tone).toBe("warning");
  });

  it("shows NOTHING after a deliberate sign out", () => {
    // Pressing Sign out and then being told something happened to your
    // session is alarming for no reason.
    expect(sessionEndNotice("signed-out")).toBeNull();
    expect(sessionEndNotice(null)).toBeNull();
  });

  it("never leaks an error code or technical vocabulary to the user", () => {
    for (const reason of ["expired", "revoked", "deactivated"] as const) {
      const notice = sessionEndNotice(reason)!;
      const text = `${notice.title} ${notice.body}`;
      for (const leak of ["401", "token", "SESSION_EXPIRED", "INVALID_SESSION", "USER_INACTIVE", "bearer"]) {
        expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
      }
    }
  });
});

describe("parseSessionEndReason — untrusted query input", () => {
  it("accepts only the four known reasons", () => {
    expect(parseSessionEndReason("expired")).toBe("expired");
    expect(parseSessionEndReason("revoked")).toBe("revoked");
    expect(parseSessionEndReason("deactivated")).toBe("deactivated");
    expect(parseSessionEndReason("signed-out")).toBe("signed-out");
  });

  it("rejects anything else, including injected copy", () => {
    expect(parseSessionEndReason("Your account was hacked, call this number")).toBeNull();
    expect(parseSessionEndReason("<script>alert(1)</script>")).toBeNull();
    expect(parseSessionEndReason("")).toBeNull();
    expect(parseSessionEndReason(null)).toBeNull();
  });
});

describe("isSafeNextPath — open-redirect guard", () => {
  it("accepts ordinary internal paths", () => {
    expect(isSafeNextPath("/finance/invoices")).toBe(true);
    expect(isSafeNextPath("/students/3d1b9c40-7a55-4a11-bd21-0c4f9a2e1a33")).toBe(true);
    expect(isSafeNextPath("/settings/academic/class-subjects?tab=jss2")).toBe(true);
    expect(isSafeNextPath("/teacher/gradebook/arm-1/subject-2")).toBe(true);
  });

  it("REJECTS an absolute external origin", () => {
    expect(isSafeNextPath("https://evil.example")).toBe(false);
    expect(isSafeNextPath("https://evil.example/login")).toBe(false);
    expect(isSafeNextPath("http://evil.example")).toBe(false);
  });

  it("REJECTS a protocol-relative URL", () => {
    // The browser reads the leading "//" as a host, so this leaves the origin
    // even though it looks like a path.
    expect(isSafeNextPath("//evil.example")).toBe(false);
    expect(isSafeNextPath("//evil.example/dashboard")).toBe(false);
  });

  it("REJECTS the backslash variant of protocol-relative", () => {
    expect(isSafeNextPath("/\\evil.example")).toBe(false);
    expect(isSafeNextPath("/\\/evil.example")).toBe(false);
  });

  it("REJECTS percent-encoded bypass attempts", () => {
    // Decoded before the check precisely so an encoded form cannot slip past
    // a naive raw-string test.
    expect(isSafeNextPath("%2f%2fevil.example")).toBe(false);
    expect(isSafeNextPath("%2F%2Fevil.example")).toBe(false);
    expect(isSafeNextPath("/%2f/evil.example")).toBe(false);
    expect(isSafeNextPath("%68%74%74%70%73%3a%2f%2fevil.example")).toBe(false);
  });

  it("REJECTS malformed encoding rather than guessing", () => {
    expect(isSafeNextPath("%")).toBe(false);
    expect(isSafeNextPath("/%zz")).toBe(false);
  });

  it("REJECTS non-path schemes", () => {
    expect(isSafeNextPath("javascript:alert(1)")).toBe(false);
    expect(isSafeNextPath("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("REJECTS control characters that could split a header or confuse a parser", () => {
    expect(isSafeNextPath("/dashboard\nSet-Cookie: a=b")).toBe(false);
    expect(isSafeNextPath("/dash\tboard")).toBe(false);
    expect(isSafeNextPath("/dashboard\r\nX: y")).toBe(false);
  });

  it("REJECTS a relative path, which resolves against whatever page is current", () => {
    expect(isSafeNextPath("dashboard")).toBe(false);
    expect(isSafeNextPath("../admin")).toBe(false);
  });

  it("REJECTS /login itself, which would loop", () => {
    expect(isSafeNextPath("/login")).toBe(false);
    expect(isSafeNextPath("/login?next=/login")).toBe(false);
  });

  it("REJECTS empty and absent values", () => {
    expect(isSafeNextPath("")).toBe(false);
    expect(isSafeNextPath(null)).toBe(false);
    expect(isSafeNextPath(undefined)).toBe(false);
  });
});

describe("resolveNextPath", () => {
  it("returns the path when safe and the fallback when not", () => {
    expect(resolveNextPath("/finance/invoices", "/dashboard")).toBe("/finance/invoices");
    expect(resolveNextPath("https://evil.example", "/dashboard")).toBe("/dashboard");
    expect(resolveNextPath(null, "/teacher/dashboard")).toBe("/teacher/dashboard");
  });
});

describe("buildLoginUrl", () => {
  it("carries both the reason and a safe destination", () => {
    const url = buildLoginUrl({ reason: "expired", next: "/finance/invoices" });
    const params = new URL(url, "http://localhost").searchParams;
    expect(params.get("reason")).toBe("expired");
    expect(params.get("next")).toBe("/finance/invoices");
  });

  it("omits an unsafe destination entirely rather than passing it along", () => {
    const url = buildLoginUrl({ reason: "expired", next: "https://evil.example" });
    expect(url).not.toContain("evil.example");
    expect(new URL(url, "http://localhost").searchParams.get("next")).toBeNull();
    // The reason still survives — a bad `next` must not suppress the
    // explanation the user needs.
    expect(new URL(url, "http://localhost").searchParams.get("reason")).toBe("expired");
  });

  it("adds NO reason and NO next for a deliberate sign out", () => {
    // Returning you to where you were is a courtesy for an interruption, not
    // for a decision to leave — and a sign-out must not look like a failure.
    expect(buildLoginUrl({ reason: "signed-out", next: "/finance/invoices" })).toBe("/login");
  });

  it("falls back to a bare /login when there is nothing to say", () => {
    expect(buildLoginUrl({ reason: null })).toBe("/login");
    expect(buildLoginUrl({ reason: null, next: null })).toBe("/login");
  });

  it("round-trips through parseSessionEndReason", () => {
    for (const reason of ["expired", "revoked", "deactivated"] as const) {
      const url = buildLoginUrl({ reason, next: "/dashboard" });
      const raw = new URL(url, "http://localhost").searchParams.get("reason");
      expect(parseSessionEndReason(raw)).toBe(reason);
    }
  });
});
