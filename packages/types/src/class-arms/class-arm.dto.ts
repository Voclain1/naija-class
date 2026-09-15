import type { TimetableClashDto } from "../timetable/timetable.dto.js";

// Phase 1 / Slice 3 — ClassArm DTO shape returned by the API.
//
// `classTeacherId` is the FK to users.id; surfaces as a bare string id
// (never the full user PII) — the UI fetches teacher names separately
// via the staff list when rendering. `capacity` is nullable; some schools
// don't track a hard cap.

export interface ClassArmDto {
  id: string;
  classLevelId: string;
  name: string;
  code: string;
  capacity: number | null;
  classTeacherId: string | null;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
  /**
   * Phase 8 / CP4 (§18 D43/D44) — set only on the response to an update that
   * RE-ACTIVATES a class: timetable clashes its timetables brought back into
   * force. Surfaced, never silent; an empty array means none.
   */
  timetableClashes?: TimetableClashDto[];
}
