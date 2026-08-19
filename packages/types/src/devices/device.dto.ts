import { z } from "zod";

// Phase 6 / Slice 5 (D34) — registering a device for Expo push.
//
// The SAME shape serves both principals. A guardian and a student register
// through different guards at different URLs, but the body is identical and
// the server derives the owner from the session — never from the body. A
// `principalType` or `guardianId` field here would be a client-supplied
// answer to a question the session already answers, which is the shape D27
// established for every other guardian action on a child.

// Expo issues tokens in two documented forms. Validated by shape rather than
// accepted as free text: a malformed token is a row that can never receive a
// notification and never errors, and D37's fallback treats "has a token" as
// "was reachable" — so a junk token silently costs a parent their SMS too.
const EXPO_PUSH_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[^\]\s]+\]$/;

export const devicePlatformValues = ["ANDROID", "IOS"] as const;
export type DevicePlatform = (typeof devicePlatformValues)[number];

export const registerDeviceSchema = z.object({
  expoPushToken: z
    .string()
    .trim()
    .regex(EXPO_PUSH_TOKEN, "That is not a valid Expo push token"),
  platform: z.enum(devicePlatformValues),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

// Deliberately does NOT echo the token back. The caller supplied it, so
// returning it adds nothing, and it keeps the value out of one more response
// body, log line and offline cache entry than it needs to be in.
export interface RegisterDeviceResponse {
  registered: true;
  platform: DevicePlatform;
}
