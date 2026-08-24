import { z } from "zod";

export const platformAdminSetStaffMobileSchema = z.object({ staffMobileEnabled: z.boolean() });
export type PlatformAdminSetStaffMobileInput = z.infer<typeof platformAdminSetStaffMobileSchema>;
export interface PlatformAdminSetStaffMobileResponse {
  schoolId: string;
  staffMobileEnabled: boolean;
}
