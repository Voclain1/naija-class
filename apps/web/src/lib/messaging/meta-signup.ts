// Only the single-account v4 finish event is supported. The backend verifies
// ownership, token scope and phone membership independently before connecting.
export type MetaSignupEvent = { kind: "finish"; wabaId: string; phoneNumberId: string } | { kind: "cancel" } | { kind: "error" };
export function parseMetaSignupEvent(origin: string, payload: unknown): MetaSignupEvent | null {
  if (origin !== "https://www.facebook.com" && origin !== "https://web.facebook.com" && origin !== "https://business.facebook.com") return null;
  if (typeof payload !== "string") return null;
  try {
    const value = JSON.parse(payload);
    if (!value || value.type !== "WA_EMBEDDED_SIGNUP") return null;
    if (value.event === "CANCEL") return { kind: "cancel" };
    if (value.event === "ERROR") return { kind: "error" };
    if (value.event !== "FINISH") return null;
    const wabaId = value.data?.waba_id;
    const phoneNumberId = value.data?.phone_number_id;
    if (typeof wabaId !== "string" || typeof phoneNumberId !== "string" || !/^\d{1,32}$/.test(wabaId) || !/^\d{1,32}$/.test(phoneNumberId)) return null;
    return { kind: "finish", wabaId, phoneNumberId };
  } catch { return null; }
}
