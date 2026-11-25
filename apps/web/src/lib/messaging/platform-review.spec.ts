import { describe, expect, it } from "vitest";
import { catalogIssue, emptyRate, unitKobo, validTemplateReview, type Rate } from "./platform-review";
const rate: Rate = {...emptyRate("TERMII_SMS"), version:"fixture-v1", evidence:"fixture-only", effectiveFrom:"2026-01-01T00:00:00Z",effectiveUntil:"2027-01-01T00:00:00Z",verifiedAt:"2026-01-01T00:00:00Z",providerAmount:"100",rateNumerator:"1",rateDenominator:"1",taxBasisPoints:"750",marginBasisPoints:"1000"};
const now = Date.parse("2026-11-25T00:00:00Z");
describe("platform messaging review forms",()=>{
  it("validates a complete effective-dated catalogue without guessing prices",()=>{
    expect(catalogIssue([rate],"platform",now)).toBeNull();
    expect(unitKobo(rate)).toBe(119n);
    expect(catalogIssue([emptyRate("TERMII_SMS")],"platform",now)).not.toBeNull();
    expect(catalogIssue([{...rate,key:"META_UTILITY"}],"platform",now)).not.toBeNull();
  });
  it("rejects overlap, future verification and invalid conversion",()=>{
    expect(catalogIssue([rate,{...rate,version:"v2"}],"school",now)).not.toBeNull();
    expect(catalogIssue([{...rate,verifiedAt:"2027-01-01T00:00:00Z"}],"school",now)).not.toBeNull();
    expect(unitKobo({...rate,rateDenominator:"0"})).toBeNull();
  });
  it("requires exact ordered variable bindings",()=>{
    const review={wabaId:"123",providerTemplateId:"456",language:"en",category:"UTILITY" as const,approvedBody:"Hello {{1}}: {{2}}",bodyFields:["studentName","balanceLeft"] as ("studentName"|"balanceLeft")[]};
    expect(validTemplateReview(review)).toBe(true);
    expect(validTemplateReview({...review,bodyFields:["studentName"]})).toBe(false);
    expect(validTemplateReview({...review,approvedBody:"Hello {{2}}: {{1}}"})).toBe(false);
  });
});
