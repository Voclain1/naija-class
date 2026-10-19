import { z } from "zod";

// ID cards (2026-10-19, docs/modules/id-cards-and-store.md §3).
//
// A card is a record: a card number, the session it is valid for and a
// status. What is PRINTED is deliberately narrow (owner's answer 2, NDPR
// minimum data): photo, name, class or role, admission or staff number, the
// session, the school's return address and phone, and a QR code. No date of
// birth, home address, blood group or parent's phone, anywhere in these DTOs.

export type IdCardHolderKindDto = "STUDENT" | "STAFF";
export type IdCardStatusDto = "ACTIVE" | "CANCELLED" | "REPLACED";

export const idCardHolderKindSchema = z.enum(["STUDENT", "STAFF"]);

/** GET /id-cards — who holds a card for a session. */
export const listIdCardsQuerySchema = z
  .object({
    kind: idCardHolderKindSchema,
    academicYearId: z.string().uuid().optional(),
    classArmId: z.string().uuid().optional(),
  })
  .strict();
export type ListIdCardsQuery = z.infer<typeof listIdCardsQuerySchema>;

export interface IdCardRefDto {
  id: string;
  cardNumber: string;
  status: IdCardStatusDto;
  issuedAt: string | Date;
}

export interface IdCardHolderRowDto {
  holderId: string;
  kind: IdCardHolderKindDto;
  name: string;
  /** Admission number (students) or staff number (staff, may be empty). */
  number: string | null;
  /** Class (students) or role (staff). */
  detail: string | null;
  hasPhoto: boolean;
  /** The ACTIVE card for the session, or null. */
  card: IdCardRefDto | null;
}

export interface IdCardHolderListDto {
  academicYear: { id: string; label: string } | null;
  data: IdCardHolderRowDto[];
}

/** POST /id-cards/issue — one card each for those without one this session. */
export const issueIdCardsSchema = z
  .object({
    kind: idCardHolderKindSchema,
    holderIds: z.array(z.string().uuid()).min(1).max(500),
    academicYearId: z.string().uuid().optional(),
  })
  .strict();
export type IssueIdCardsInput = z.infer<typeof issueIdCardsSchema>;

export interface IssueIdCardsResultDto {
  issued: number;
  /** Already held an active card for the session. */
  skipped: number;
}

/** POST /id-cards/:id/cancel and /id-cards/:id/reissue. */
export const endIdCardSchema = z
  .object({
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
export type EndIdCardInput = z.infer<typeof endIdCardSchema>;

/** POST /id-cards/print — the data for the cards to print. */
export const printIdCardsSchema = z
  .object({
    cardIds: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict();
export type PrintIdCardsInput = z.infer<typeof printIdCardsSchema>;

export interface IdCardSchoolDto {
  name: string;
  motto: string | null;
  address: string | null;
  phone: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
}

/** One card, front and back, as printed or shown in an app. */
export interface PrintableIdCardDto {
  id: string;
  kind: IdCardHolderKindDto;
  cardNumber: string;
  status: IdCardStatusDto;
  name: string;
  number: string | null;
  detail: string | null;
  validFor: string;
  validUntil: string;
  photoUrl: string | null;
  /** The address the QR code opens. */
  verifyUrl: string;
}

export interface PrintIdCardsDto {
  school: IdCardSchoolDto;
  cards: PrintableIdCardDto[];
}

/** GET /id-cards/me, GET /student-portal/me/id-card. */
export interface MyIdCardDto {
  school: IdCardSchoolDto;
  card: PrintableIdCardDto | null;
}

/** GET /public/id-cards/verify?t= — the public QR check. */
/** LEFT: the card itself is live, but its holder has left the school (withdrawn, or the account switched off). */
export type IdCardVerdictDto = "VALID" | "EXPIRED" | "CANCELLED" | "REPLACED" | "LEFT";

export interface IdCardVerificationDto {
  verdict: IdCardVerdictDto;
  schoolName: string;
  kind: IdCardHolderKindDto;
  name: string;
  detail: string | null;
  cardNumber: string;
  validFor: string;
  photoUrl: string | null;
}
