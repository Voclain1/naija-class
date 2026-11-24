import { describe, expect, it } from "vitest";
import { parseTopUpNaira, safeCheckoutUrl } from "./wallet-funding";
describe("messaging wallet funding", () => {
  it("converts naira to exact integer kobo", () => {
    expect(parseTopUpNaira("1500.05")).toBe("150005");
    expect(parseTopUpNaira("0.01")).toBe("1");
    expect(parseTopUpNaira("1500.5")).toBe("150050");
  });
  it("rejects fractional kobo, zero, exponent notation and excessive amounts", () => {
    for (const value of ["0", "-1", "1.005", "1e3", "100000000", "NaN", ""]) expect(parseTopUpNaira(value)).toBeNull();
  });
  it("allows only official HTTPS checkout URLs without credentials", () => {
    expect(safeCheckoutUrl("https://checkout.paystack.com/example")).toBe("https://checkout.paystack.com/example");
    for (const url of ["https://checkout.paystack.com.evil.test/pay", "http://checkout.paystack.com/pay", "https://user@checkout.paystack.com/pay", "javascript:alert(1)"]) expect(safeCheckoutUrl(url)).toBeNull();
  });
});
