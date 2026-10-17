import { z } from "zod";

// ---------------------------------------------------------------------------
// Phase 9 / CP6b — hostels and boarding (docs/modules/phase-9.md §15, owner's
// answers §15.8).
//
// A hostel is for boys or girls, with house masters and a fee per term that
// stands for every term and session until changed. Rooms have beds numbered
// 1..n. A student holds one bed a term, which raises a hostel student charge
// at the hostel's fee; nobody types an amount per child. Money is kobo.
// ---------------------------------------------------------------------------

/** ₦10,000,000 in kobo — the student-charge ceiling. */
export const MAX_HOSTEL_FEE_KOBO = 1_000_000_000;
export const MAX_ROOM_BEDS = 60;

export type HostelGender = "BOYS" | "GIRLS";
export const HOSTEL_GENDER_LABEL: Record<HostelGender, string> = { BOYS: "Boys", GIRLS: "Girls" };

export interface HostelRoomDto {
  id: string;
  name: string;
  beds: number;
  /** Beds taken in the term asked for (0 when no term was given). */
  taken: number;
}

export interface HostelDto {
  id: string;
  name: string;
  forGender: HostelGender;
  fee: number; // kobo per term; 0 is none
  houseMasters: { id: string; name: string }[];
  rooms: HostelRoomDto[];
  /** All the hostel's beds, and those taken in the term asked for. */
  beds: number;
  taken: number;
}

export const listHostelsSchema = z.object({ termId: z.string().uuid().optional() });
export type ListHostelsInput = z.infer<typeof listHostelsSchema>;

export const createHostelSchema = z.object({
  name: z.string().trim().min(1, "Give the hostel a name.").max(80),
  forGender: z.enum(["BOYS", "GIRLS"]),
});
export type CreateHostelInput = z.infer<typeof createHostelSchema>;
export const updateHostelSchema = createHostelSchema.partial();
export type UpdateHostelInput = z.infer<typeof updateHostelSchema>;

/** Set on the hostel's own page; it stands for later terms and sessions until changed. */
export const setHostelFeeSchema = z.object({
  fee: z.number().int().min(0).max(MAX_HOSTEL_FEE_KOBO),
});
export type SetHostelFeeInput = z.infer<typeof setHostelFeeSchema>;

export interface SetHostelFeeResultDto {
  hostel: HostelDto;
  repriced: number;
  raised: number;
  voided: number;
  keptBilled: number;
}

export const setHouseMastersSchema = z.object({
  userIds: z.array(z.string().uuid()).max(10),
});
export type SetHouseMastersInput = z.infer<typeof setHouseMastersSchema>;

/** Staff who may be made a house master: teachers and House masters. */
export interface HouseMasterCandidateDto {
  id: string;
  name: string;
  role: string;
}

export const roomSchema = z.object({
  name: z.string().trim().min(1, "Give the room a name.").max(60),
  beds: z.number().int().min(1).max(MAX_ROOM_BEDS),
});
export type RoomInput = z.infer<typeof roomSchema>;
export const updateRoomSchema = roomSchema.partial();
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

// ─── Beds ──────────────────────────────────────────────────────────────────

export interface HostelBedDto {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  classArm: string | null;
  termId: string;
  hostelId: string;
  roomId: string;
  roomName: string;
  bedNumber: number;
  /** The hostel charge for this bed, if the hostel charges a fee. */
  charge: { status: "OPEN" | "BILLED" | "VOID"; amount: number } | null;
}

export const listBedsSchema = z.object({ termId: z.string().uuid() });
export type ListBedsInput = z.infer<typeof listBedsSchema>;

export const createBedSchema = z.object({
  studentId: z.string().uuid(),
  termId: z.string().uuid(),
  roomId: z.string().uuid(),
  /** The first free bed when left out. */
  bedNumber: z.number().int().min(1).max(MAX_ROOM_BEDS).optional(),
});
export type CreateBedInput = z.infer<typeof createBedSchema>;

export const moveBedSchema = z.object({
  roomId: z.string().uuid(),
  bedNumber: z.number().int().min(1).max(MAX_ROOM_BEDS).optional(),
});
export type MoveBedInput = z.infer<typeof moveBedSchema>;

export const copyBedsSchema = z
  .object({ fromTermId: z.string().uuid(), toTermId: z.string().uuid() })
  .refine((v) => v.fromTermId !== v.toTermId, { message: "Choose a different term to copy to." });
export type CopyBedsInput = z.infer<typeof copyBedsSchema>;

export interface CopyBedsResultDto {
  copied: number;
  alreadyPlaced: number;
  /** The same bed was taken (or the room smaller) in the new term. */
  bedTaken: number;
  leftSchool: number;
}

/** The student page's line: their bed this term. */
export interface StudentHostelDto {
  termId: string;
  termName: string;
  hostelName: string;
  roomName: string;
  bedNumber: number;
}

// ─── House masters (CP6b.2, §15 CP6b-D4, D5, D7) ───────────────────────────

/** A hostel the caller keeps: their own as house master, or every one for owner and admin. */
export interface HouseHostelDto {
  id: string;
  name: string;
  forGender: HostelGender;
  /** Boarders this term (0 when no term is current). */
  boarders: number;
}

/**
 * A boarder on the house master's list. The sickbay shows only that the child
 * was sent home today, never the complaint, action or medicine (owner, §15.8).
 */
export interface HouseBoarderDto {
  bedId: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  classArm: string | null;
  roomName: string;
  bedNumber: number;
  sentHomeToday: boolean;
}

export interface HouseBoardersDto {
  hostel: { id: string; name: string; forGender: HostelGender };
  /** The current term; null when none is set, and then there are no boarders. */
  term: { id: string; name: string } | null;
  boarders: HouseBoarderDto[];
}

export const HOSTEL_VISIT_LIMITS = { visitorName: 80, relationship: 40 } as const;

export const logHostelVisitSchema = z.object({
  studentId: z.string().uuid(),
  visitorName: z.string().trim().min(1, "Enter the visitor's name.").max(HOSTEL_VISIT_LIMITS.visitorName),
  relationship: z.string().trim().min(1, "Say who the visitor is to the child.").max(HOSTEL_VISIT_LIMITS.relationship),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{7,20}$/, "Enter a phone number, or leave it empty.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Now when left out. */
  arrivedAt: z.string().datetime({ offset: true }).optional(),
});
export type LogHostelVisitInput = z.infer<typeof logHostelVisitSchema>;

export const hostelVisitLeftSchema = z.object({
  /** Now when left out. */
  leftAt: z.string().datetime({ offset: true }).optional(),
});
export type HostelVisitLeftInput = z.infer<typeof hostelVisitLeftSchema>;

/** One Lagos day of the log (YYYY-MM-DD); today when left out. */
export const listHostelVisitsSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-15.").optional(),
});
export type ListHostelVisitsInput = z.infer<typeof listHostelVisitsSchema>;

export interface HostelVisitDto {
  id: string;
  studentId: string;
  studentName: string;
  visitorName: string;
  relationship: string;
  phone: string | null;
  arrivedAt: string | Date;
  leftAt: string | Date | null;
  loggedByName: string | null;
}

// ─── Families (CP6b.2, §15 CP6b-D8) ────────────────────────────────────────

/** The parent's hostel card: this term's bed and the house masters' names. No phones, no visits. */
export interface PortalStudentHostelDto {
  termName: string;
  hostelName: string;
  roomName: string;
  bedNumber: number;
  houseMasters: string[];
}
