import { z } from "zod";

// PATCH /platform-admin/schools/:schoolId/smart-import — turns Smart Student
// Import (photograph a register; the model transcribes it) on or off for one
// school (2026-10-11).
//
// It is the only feature that sends student PII to the model (CLAUDE.md's
// one-prompt allowlist), and docs/modules/smart-student-import.md says no
// school should use it before the real-register accuracy check. So it has its
// own switch, off by default, that only the platform operator can open. It
// only narrows: the school's aiEnabled, its budget and the platform AI_ENABLED
// switch still apply, so turning this on for a school with AI off does
// nothing until AI is on too.
export const platformAdminSetSmartImportSchema = z.object({
  smartImportEnabled: z.boolean(),
});

export type PlatformAdminSetSmartImportInput = z.infer<typeof platformAdminSetSmartImportSchema>;

export interface PlatformAdminSetSmartImportResponse {
  schoolId: string;
  smartImportEnabled: boolean;
}
