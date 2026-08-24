import { z } from "zod";
import type { LoginResponse } from "./login.dto.js";

const mobileDeviceSchema = z.object({
  deviceId: z.string().min(16).max(128),
  deviceName: z.string().trim().min(1).max(80),
});

export const staffMobileLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
}).and(mobileDeviceSchema);
export type StaffMobileLoginInput = z.infer<typeof staffMobileLoginSchema>;

export const staffMobileChallengeSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().length(6).regex(/^\d{6}$/),
}).and(mobileDeviceSchema);
export type StaffMobileChallengeInput = z.infer<typeof staffMobileChallengeSchema>;
export type StaffMobileLoginResponse = LoginResponse;

export interface StaffSessionDto {
  id: string;
  clientType: "WEB" | "MOBILE";
  deviceName: string | null;
  createdAt: string | Date;
  lastSeenAt: string | Date;
  expiresAt: string | Date;
  current: boolean;
}

export interface StaffSessionListResponse {
  sessions: StaffSessionDto[];
}
