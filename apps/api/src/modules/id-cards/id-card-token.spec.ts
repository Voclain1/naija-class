import { describe, expect, it } from "vitest";

import { idCardToken, readIdCardToken } from "./id-card-token";

const KEY = "test-key-for-id-cards-0123456789abcdef";
const CARD = "3f1c2a4e-7b8d-4e9f-a0b1-c2d3e4f5a6b7";

describe("ID card QR code", () => {
  it("reads back the school and card it was made for", () => {
    const token = idCardToken("bright-future", CARD, KEY);
    expect(readIdCardToken(token, KEY)).toEqual({ slug: "bright-future", cardId: CARD });
  });

  it("refuses a changed card id, a changed signature and another key", () => {
    const token = idCardToken("bright-future", CARD, KEY);
    const [slug, , sig] = token.split(".");
    expect(readIdCardToken(`${slug}.3f1c2a4e-7b8d-4e9f-a0b1-c2d3e4f5a6b8.${sig}`, KEY)).toBeNull();
    expect(readIdCardToken(`${token}x`, KEY)).toBeNull();
    expect(readIdCardToken(token, "another-key-0123456789abcdef0123")).toBeNull();
    expect(readIdCardToken("nonsense", KEY)).toBeNull();
  });
});
