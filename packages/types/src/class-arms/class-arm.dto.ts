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
}
