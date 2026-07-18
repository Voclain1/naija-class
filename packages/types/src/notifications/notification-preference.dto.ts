// Phase 4 / Slice 6 — per-school notification channel preferences (D3).
//
// A school with no configured row yet reads back the schema defaults
// (email on, SMS off — see NotificationPreferenceService.get) rather than
// 404ing or auto-creating a row on first read. updatedBy/updatedAt are null
// in that unconfigured case; once a school saves preferences (even leaving
// values unchanged), both are set and stay set.
export interface NotificationPreferenceDto {
  emailEnabled: boolean;
  smsEnabled: boolean;
  // Always false — dark until the mobile phase (D3). Not settable via
  // UpdateNotificationPreferencesInput; present here only so the read shape
  // is stable ahead of that later slice, same reasoning StudentDetailDto's
  // header comment gives for keeping a shape stable before it's populated.
  pushEnabled: boolean;
  updatedBy: string | null;
  updatedAt: string | Date | null;
}
