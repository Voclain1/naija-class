import { describe, expect, it } from "vitest";
import { parseMetaSignupEvent } from "./meta-signup";
const finish = JSON.stringify({type:"WA_EMBEDDED_SIGNUP",event:"FINISH",data:{waba_id:"12345",phone_number_id:"67890"}});
describe("Meta embedded signup event handling", () => {
  it("accepts supported v4 single-account completion", () => {
    expect(parseMetaSignupEvent("https://www.facebook.com",finish)).toEqual({kind:"finish",wabaId:"12345",phoneNumberId:"67890"});
  });
  it("rejects lookalike origins, HTTP, unrelated messages and incomplete account information", () => {
    for (const origin of ["https://facebook.com.evil.test","https://evilfacebook.com","http://www.facebook.com","https://evil.test"]) expect(parseMetaSignupEvent(origin,finish)).toBeNull();
    for (const data of ["garbage",JSON.stringify({type:"WA_EMBEDDED_SIGNUP",event:"FINISH",data:{waba_id:"123"}}),JSON.stringify({type:"WA_EMBEDDED_SIGNUP",event:"FINISH_ONLY_WABA",data:{waba_id:"123"}})]) expect(parseMetaSignupEvent("https://www.facebook.com",data)).toBeNull();
  });
  it("handles cancellation without returning provider data", () => {
    expect(parseMetaSignupEvent("https://www.facebook.com",JSON.stringify({type:"WA_EMBEDDED_SIGNUP",event:"CANCEL"}))).toEqual({kind:"cancel"});
  });
});
