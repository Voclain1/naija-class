import { z } from "zod";

// ---------------------------------------------------------------------------
// Phase 9 / CP6 — the library (docs/modules/phase-9.md §14 CP6-D1/D2).
//
// A book, its physical copies (each with an accession number unique in the
// school), and loans of a copy to a student or a member of staff. Due dates
// are calendar dates in Lagos. Money (the replacement price) is kobo.
// ---------------------------------------------------------------------------

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

/** ₦1,000,000 in kobo — the highest replacement price. */
export const MAX_REPLACEMENT_PRICE_KOBO = 100_000_000;
/** The most copies added in one go. */
export const MAX_COPIES_AT_ONCE = 200;

/** Upper case, inner spaces collapsed: what a label or a scanner gives. */
export function normaliseAccessionNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}
const accessionNumber = z.string().trim().min(1).max(30).transform(normaliseAccessionNumber);

/** Hyphens and spaces removed; a trailing x becomes X. Null when empty. */
export function normaliseIsbn(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}
const isbn = z
  .string()
  .trim()
  .max(20)
  .transform((v) => (v === "" ? null : normaliseIsbn(v)))
  .refine((v) => v === null || /^([0-9]{9}[0-9X]|[0-9]{13})$/.test(v), "An ISBN has 10 or 13 digits.")
  .nullable()
  .optional();

// ─── Settings and context ──────────────────────────────────────────────────

export interface LibrarySettingsDto {
  loanDays: number;
  studentLimit: number;
  staffLimit: number;
  renewalLimit: number;
  /** The next number "Number them for me" hands out. */
  nextAccession: number;
  /** CP6.2 — fines, off by default (CP6-D3). Students only. Kobo. */
  finesEnabled: boolean;
  finePerDay: number;
  fineGraceDays: number;
  /** The most one loan can be fined; null for no cap. */
  fineCap: number | null;
}

/** ₦10,000 a day in kobo — the highest daily fine. */
export const MAX_FINE_PER_DAY_KOBO = 1_000_000;

export const updateLibrarySettingsSchema = z.object({
  loanDays: z.number().int().min(1).max(180).optional(),
  studentLimit: z.number().int().min(0).max(20).optional(),
  staffLimit: z.number().int().min(0).max(50).optional(),
  renewalLimit: z.number().int().min(0).max(10).optional(),
  finesEnabled: z.boolean().optional(),
  finePerDay: z.number().int().min(0).max(MAX_FINE_PER_DAY_KOBO).optional(),
  fineGraceDays: z.number().int().min(0).max(30).optional(),
  fineCap: z.number().int().min(0).max(MAX_REPLACEMENT_PRICE_KOBO).nullable().optional(),
});
export type UpdateLibrarySettingsInput = z.infer<typeof updateLibrarySettingsSchema>;

/** What the library's screens need to fill their pickers, without roster access. */
export interface LibraryContextDto {
  settings: LibrarySettingsDto;
  subjects: { id: string; name: string }[];
  levels: { id: string; name: string }[];
}

// ─── Books and copies ──────────────────────────────────────────────────────

export type LibraryCopyStatus = "AVAILABLE" | "ON_LOAN" | "LOST" | "WITHDRAWN";
export type LibraryBorrowerKind = "STUDENT" | "STAFF";

export interface LibraryBookSummaryDto {
  id: string;
  title: string;
  authors: string | null;
  isbn: string | null;
  subjectName: string | null;
  shelfLocation: string | null;
  referenceOnly: boolean;
  /** Copies not withdrawn or lost. */
  copies: number;
  available: number;
}

export interface LibraryBorrowerRefDto {
  kind: LibraryBorrowerKind;
  id: string;
  name: string;
  /** "ADM/001 · JSS 1 Gold" for a student, "Staff" for staff. */
  detail: string;
}

export interface LibraryLoanDto {
  id: string;
  copyId: string;
  accessionNumber: string;
  bookId: string;
  title: string;
  borrower: LibraryBorrowerRefDto;
  issuedAt: string;
  dueOn: string; // YYYY-MM-DD
  renewals: number;
  /** Renewals still allowed under the school's limit. */
  renewalsLeft: number;
  returnedAt: string | null;
  /** CP6.2 — set when the book was marked lost; a lost loan is closed. */
  lostAt: string | null;
  foundAt: string | null;
  /** Open and past its due date, by Lagos calendar day. */
  overdue: boolean;
  daysLate: number;
  /**
   * An open student loan, fines on: what returning it today would cost, by the
   * same rule the return applies. 0 when nothing is due yet. Null otherwise.
   */
  fineSoFar: number | null;
  /** A closed loan: the fine or replacement price worked out, if any (kobo). */
  fineAmount: number | null;
  /** Set when the librarian waived it. */
  fineWaivedReason: string | null;
}

export interface LibraryCopyDto {
  id: string;
  accessionNumber: string;
  status: LibraryCopyStatus;
  note: string | null;
  /** The open loan, when ON_LOAN. */
  loan: LibraryLoanDto | null;
}

export interface LibraryBookDto extends LibraryBookSummaryDto {
  publisher: string | null;
  publishedYear: number | null;
  subjectId: string | null;
  replacementPrice: number | null; // kobo
  levels: { id: string; name: string }[];
  copyList: LibraryCopyDto[];
  /** Whether any copy has ever been lent; such a book cannot be deleted. */
  hasLoans: boolean;
}

export const listBooksSchema = z.object({
  q: z.string().trim().max(100).optional(),
  subjectId: z.string().min(1).optional(),
});
export type ListBooksInput = z.infer<typeof listBooksSchema>;

const bookFields = {
  title: z.string().trim().min(1, "Enter the title.").max(300),
  authors: optionalText(300),
  isbn,
  publisher: optionalText(120),
  publishedYear: z.number().int().min(1400).max(2100).nullable().optional(),
  subjectId: z.string().min(1).nullable().optional(),
  shelfLocation: optionalText(60),
  replacementPrice: z.number().int().min(0).max(MAX_REPLACEMENT_PRICE_KOBO).nullable().optional(),
  referenceOnly: z.boolean().optional(),
  levelIds: z.array(z.string().min(1)).max(30).optional(),
};

/**
 * Copies to add: either the accession numbers on their labels, or a count to
 * be numbered from the school's next number.
 */
export const addCopiesSchema = z
  .object({
    count: z.number().int().min(1).max(MAX_COPIES_AT_ONCE).optional(),
    accessionNumbers: z.array(accessionNumber).min(1).max(MAX_COPIES_AT_ONCE).optional(),
  })
  .refine((v) => (v.count === undefined) !== (v.accessionNumbers === undefined), {
    message: "Give a number of copies or their accession numbers, not both.",
  })
  .refine((v) => !v.accessionNumbers || new Set(v.accessionNumbers).size === v.accessionNumbers.length, {
    message: "The same accession number is listed twice.",
  });
export type AddCopiesInput = z.infer<typeof addCopiesSchema>;

export const createBookSchema = z.object({ ...bookFields, copies: addCopiesSchema.optional() });
export type CreateBookInput = z.infer<typeof createBookSchema>;
export const updateBookSchema = z.object(bookFields).partial();
export type UpdateBookInput = z.infer<typeof updateBookSchema>;

/** A copy on loan cannot be withdrawn; LOST is set by marking a loan lost (CP6.2). */
export const updateCopySchema = z.object({
  status: z.enum(["AVAILABLE", "WITHDRAWN"]).optional(),
  note: optionalText(200),
});
export type UpdateCopyInput = z.infer<typeof updateCopySchema>;

/** The lending desk's look-up of a copy by its accession number. */
export interface LibraryCopyLookupDto {
  copy: { id: string; accessionNumber: string; status: LibraryCopyStatus };
  book: { id: string; title: string; authors: string | null; referenceOnly: boolean; replacementPrice: number | null };
  loan: LibraryLoanDto | null;
}

// ─── Borrowers and loans ───────────────────────────────────────────────────

export interface LibraryBorrowerDto extends LibraryBorrowerRefDto {
  booksOut: number;
  /** The school's limit for this kind of borrower. */
  limit: number;
}

export const listBorrowersSchema = z.object({
  q: z.string().trim().min(1).max(100),
  kind: z.enum(["STUDENT", "STAFF"]),
});
export type ListBorrowersInput = z.infer<typeof listBorrowersSchema>;

export const issueLoanSchema = z
  .object({
    accessionNumber,
    studentId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    /** Defaults to today plus the school's loan period. */
    dueOn: date.optional(),
  })
  .refine((v) => (v.studentId === undefined) !== (v.userId === undefined), {
    message: "Choose one borrower.",
  });
export type IssueLoanInput = z.infer<typeof issueLoanSchema>;

export const returnLoanSchema = z.object({
  accessionNumber,
  /** Waives the fine (CP6-D3). A reason is required to waive. */
  waiveReason: z.string().trim().min(3, "Say why the fine is waived.").max(300).optional(),
});
export type ReturnLoanInput = z.infer<typeof returnLoanSchema>;

export const listLoansSchema = z.object({
  state: z.enum(["OPEN", "OVERDUE", "RETURNED", "LOST"]).default("OPEN"),
  q: z.string().trim().max(100).optional(),
});
export type ListLoansInput = z.infer<typeof listLoansSchema>;

/** A borrower's books out, for the student and staff pages. */
export interface LibraryBorrowerLoansDto {
  loans: LibraryLoanDto[];
  limit: number;
}

export const lookupCopySchema = z.object({ accessionNumber: z.string().trim().min(1).max(30) });
export type LookupCopyInput = z.infer<typeof lookupCopySchema>;

/** CP6.2 — marking an open loan lost (CP6-D4). */
export const markLostSchema = z.object({
  waiveReason: z.string().trim().min(3, "Say why the charge is waived.").max(300).optional(),
});
export type MarkLostInput = z.infer<typeof markLostSchema>;

/** What a return or a loss charged, said back to the librarian. */
export interface LibraryLoanResultDto {
  loan: LibraryLoanDto;
  /** Kobo raised as a student charge; 0 when nothing was raised. */
  charged: number;
  /** For a book found again: what happened to its charge. */
  charge?: "voided" | "billed" | "none";
}

// ─── Families (CP6-D6) ─────────────────────────────────────────────────────

/** A book a child has out, for the parent and the child. No borrower details. */
export interface FamilyLibraryLoanDto {
  id: string;
  title: string;
  authors: string | null;
  dueOn: string;
  overdue: boolean;
  daysLate: number;
}

export interface FamilyLibraryDto {
  loans: FamilyLibraryLoanDto[];
}

// ─── Digital resources (CP6.3, CP6-D7) ────────────────────────────────────

export type LibraryResourceKind = "FILE" | "LINK";

export interface LibraryResourceDto {
  id: string;
  title: string;
  description: string | null;
  subject: { id: string; name: string };
  levels: { id: string; name: string }[];
  kind: LibraryResourceKind;
  /** LINK only. A FILE opens through a short-lived link from its own route. */
  url: string | null;
  fileSize: number | null;
  addedBy: { id: string; name: string };
  createdAt: string;
  /** Whether the reader may remove it: the librarian, owner or admin, or the teacher who added it. */
  canRemove: boolean;
}

/** What a staff member may add: everything, or the (level, subject) pairs they teach. */
export interface LibraryResourceScopeDto {
  any: boolean;
  subjects: { id: string; name: string }[];
  levels: { id: string; name: string }[];
  /** For a teacher: the levels at which they teach each subject. */
  pairs: { subjectId: string; classLevelId: string }[];
}

export interface LibraryResourceListDto {
  resources: LibraryResourceDto[];
  scope: LibraryResourceScopeDto;
}

const resourceFields = {
  title: z.string().trim().min(1, "Give it a title.").max(200),
  description: optionalText(500),
  subjectId: z.string().min(1, "Choose the subject."),
  levelIds: z.array(z.string().min(1)).min(1, "Choose at least one class.").max(30),
};

export const createResourceLinkSchema = z.object({
  ...resourceFields,
  url: z
    .string()
    .trim()
    .max(500)
    .url("Enter a web address.")
    .refine((v) => v.startsWith("https://"), "The address must start with https://"),
});
export type CreateResourceLinkInput = z.infer<typeof createResourceLinkSchema>;

/** The fields sent beside an uploaded PDF, as the multipart "data" field (JSON). */
export const createResourceFileSchema = z.object(resourceFields);
export type CreateResourceFileInput = z.infer<typeof createResourceFileSchema>;

export const listResourcesSchema = z.object({
  subjectId: z.string().min(1).optional(),
  classLevelId: z.string().min(1).optional(),
});
export type ListResourcesInput = z.infer<typeof listResourcesSchema>;

/** A student's view of a resource: nothing about who added it. */
export interface StudentLibraryResourceDto {
  id: string;
  title: string;
  description: string | null;
  subjectName: string;
  kind: LibraryResourceKind;
  url: string | null;
}

export interface StudentLibraryResourcesDto {
  resources: StudentLibraryResourceDto[];
}

export interface LibraryResourceUrlDto {
  url: string;
}
