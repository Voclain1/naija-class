import { describe, expect, it } from "vitest";

import { extractToken } from "./extract-token";

// What a parent actually forwards is a whole link; what a child sometimes
// gets read out to them is a bare code. Both have to work, because the person
// pasting is not going to know which one they have.
describe("extractToken", () => {
  const TOKEN = "aB3dEf-Gh1jKlMnOpQrStUv";

  it("accepts a bare token unchanged", () => {
    expect(extractToken(TOKEN)).toBe(TOKEN);
  });

  it("takes the token out of a full URL", () => {
    expect(extractToken(`https://app.schoolkit.ng/activate/${TOKEN}`)).toBe(TOKEN);
  });

  it("ignores a query string or fragment", () => {
    // A forwarded link picks these up from messaging apps and link trackers.
    expect(extractToken(`https://app.schoolkit.ng/activate/${TOKEN}?utm=whatsapp`)).toBe(TOKEN);
    expect(extractToken(`https://app.schoolkit.ng/activate/${TOKEN}#top`)).toBe(TOKEN);
  });

  it("tolerates a trailing slash", () => {
    expect(extractToken(`https://app.schoolkit.ng/activate/${TOKEN}/`)).toBe(TOKEN);
  });

  it("trims surrounding whitespace from a paste", () => {
    expect(extractToken(`   ${TOKEN}\n`)).toBe(TOKEN);
  });

  it("returns empty for input with no token in it", () => {
    expect(extractToken("")).toBe("");
    expect(extractToken("   ")).toBe("");
    expect(extractToken("/")).toBe("");
    expect(extractToken("///")).toBe("");
  });

  it("does not invent a token from a bare origin", () => {
    // Returning the HOST here would be worse than returning nothing: it looks
    // like a code, gets sent to the server, and comes back "link is no longer
    // valid" — sending the child off for a replacement link when the one they
    // have is fine and they simply pasted too little of it.
    expect(extractToken("https://app.schoolkit.ng")).toBe("");
    expect(extractToken("https://app.schoolkit.ng/")).toBe("");
  });
});
