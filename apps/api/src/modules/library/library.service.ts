import { Injectable } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  addDaysIso,
  ConflictError,
  lagosTodayIso,
  normaliseIsbn,
  NotFoundError,
  ValidationError,
  type AddCopiesInput,
  type CreateBookInput,
  type IssueLoanInput,
  type LibraryBookDto,
  type LibraryBookSummaryDto,
  type LibraryBorrowerDto,
  type LibraryBorrowerKind,
  type LibraryBorrowerLoansDto,
  type LibraryContextDto,
  type LibraryCopyLookupDto,
  type LibraryLoanDto,
  type LibrarySettingsDto,
  type ListBooksInput,
  type ListBorrowersInput,
  type ListLoansInput,
  type ReturnLoanInput,
  type UpdateBookInput,
  type UpdateCopyInput,
  type UpdateLibrarySettingsInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";

// Phase 9 / CP6.1 — the library's catalogue and lending (docs/modules/phase-9.md
// §14 CP6-D1/D2/D8).
//
// A book, its physical copies (accession number unique in the school, upper
// case), and loans of a copy to a student or a member of staff.
//
// ONE LOAN PER COPY. Issuing locks the copy row (SELECT … FOR UPDATE) and
// checks it is AVAILABLE; the partial unique index library_loans_open_copy_key
// is the backstop. The borrower's row is locked too, so their limit holds when
// two librarians lend to the same child at once.
//
// DATES. Due dates are Lagos calendar dates. A loan is overdue from the day
// after its due date. A renewal is allowed only before that, up to the school's
// limit, and runs one loan period from today (never earlier than the current
// due date).
//
// WHO. owner, admin and the librarian read, keep the catalogue and lend. The
// loan period and limits (and, from CP6.2, the fine rules) are owner and
// admin only. The library returns the student, staff, subject and class-level
// names its screens need, so the librarian holds no roster permission.

const LIBRARY_ROLES = ["owner", "admin", "librarian"] as const;
const SETTINGS_ROLES = ["owner", "admin"] as const;

const DEFAULT_SETTINGS = { loanDays: 14, studentLimit: 2, staffLimit: 5, renewalLimit: 2, nextAccession: 1 };

const AUDIT = {
  book: "library.book",
  copy: "library.copy",
  issue: "library.loan.issue",
  return: "library.loan.return",
  renew: "library.loan.renew",
  settings: "library.settings",
} as const;

type Db = PrismaClient;
interface RequestContext {
  ipAddress: string | null;
}

const LOAN_INCLUDE = {
  copy: { select: { id: true, accessionNumber: true, book: { select: { id: true, title: true } } } },
  student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } },
  user: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LibraryLoanInclude;
type LoanRow = Prisma.LibraryLoanGetPayload<{ include: typeof LOAN_INCLUDE }>;

const BOOK_INCLUDE = {
  subject: { select: { id: true, name: true } },
  levels: { select: { classLevel: { select: { id: true, name: true, orderIndex: true } } } },
  copies: { orderBy: { accessionNumber: "asc" as const } },
} satisfies Prisma.LibraryBookInclude;
type BookRow = Prisma.LibraryBookGetPayload<{ include: typeof BOOK_INCLUDE }>;

@Injectable()
export class LibraryService {
  // ─── Settings and context ─────────────────────────────────────────────────

  async context(authCtx: AuthContext): Promise<LibraryContextDto> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const [settings, subjects, levels] = await Promise.all([
        readSettings(db, authCtx.schoolId),
        db.subject.findMany({ where: { schoolId: authCtx.schoolId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        db.classLevel.findMany({ where: { schoolId: authCtx.schoolId }, select: { id: true, name: true }, orderBy: { orderIndex: "asc" } }),
      ]);
      return { settings, subjects, levels };
    });
  }

  async updateSettings(authCtx: AuthContext, input: UpdateLibrarySettingsInput, req: RequestContext): Promise<LibrarySettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, SETTINGS_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.librarySettings.upsert({
        where: { schoolId: authCtx.schoolId },
        create: { schoolId: authCtx.schoolId, ...input },
        update: input,
      });
      await audit(db, authCtx, req, AUDIT.settings, row.id, {
        loanDays: row.loanDays,
        studentLimit: row.studentLimit,
        staffLimit: row.staffLimit,
        renewalLimit: row.renewalLimit,
      });
      return settingsDto(row);
    });
  }

  // ─── Books ────────────────────────────────────────────────────────────────

  async listBooks(authCtx: AuthContext, query: ListBooksInput): Promise<LibraryBookSummaryDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const q = query.q?.trim();
      const rows = await db.libraryBook.findMany({
        where: {
          schoolId: authCtx.schoolId,
          ...(query.subjectId ? { subjectId: query.subjectId } : {}),
          ...(q
            ? {
                OR: [
                  { title: { contains: q, mode: "insensitive" } },
                  { authors: { contains: q, mode: "insensitive" } },
                  { isbn: { contains: q.replace(/[\s-]/g, "").toUpperCase() } },
                  { copies: { some: { accessionNumber: q.toUpperCase() } } },
                ],
              }
            : {}),
        },
        include: BOOK_INCLUDE,
        orderBy: { title: "asc" },
        take: 200,
      });
      return rows.map(bookSummaryDto);
    });
  }

  async getBook(authCtx: AuthContext, id: string): Promise<LibraryBookDto> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, (db) => this.readBook(db, authCtx.schoolId, id));
  }

  async createBook(authCtx: AuthContext, input: CreateBookInput, req: RequestContext): Promise<LibraryBookDto> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      await assertSubjectAndLevels(db, authCtx.schoolId, input.subjectId ?? null, input.levelIds ?? []);
      const row = await db.libraryBook.create({
        data: {
          schoolId: authCtx.schoolId,
          title: input.title,
          authors: input.authors ?? null,
          isbn: input.isbn ? normaliseIsbn(input.isbn) : null,
          publisher: input.publisher ?? null,
          publishedYear: input.publishedYear ?? null,
          subjectId: input.subjectId ?? null,
          shelfLocation: input.shelfLocation ?? null,
          replacementPrice: input.replacementPrice ?? null,
          referenceOnly: input.referenceOnly ?? false,
          createdBy: authCtx.userId,
          levels: { create: (input.levelIds ?? []).map((classLevelId) => ({ schoolId: authCtx.schoolId, classLevelId })) },
        },
      });
      const added = input.copies ? await insertCopies(db, authCtx.schoolId, row.id, input.copies) : 0;
      await audit(db, authCtx, req, AUDIT.book, row.id, { op: "create", copies: added });
      return this.readBook(db, authCtx.schoolId, row.id);
    });
  }

  async updateBook(authCtx: AuthContext, id: string, input: UpdateBookInput, req: RequestContext): Promise<LibraryBookDto> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.libraryBook.findFirst({ where: { id, schoolId: authCtx.schoolId }, select: { id: true } });
      if (!existing) throw new NotFoundError("Book not found.");
      await assertSubjectAndLevels(db, authCtx.schoolId, input.subjectId ?? null, input.levelIds ?? []);
      const { levelIds, ...fields } = input;
      await db.libraryBook.update({
        where: { id },
        data: { ...fields, ...(fields.isbn !== undefined ? { isbn: fields.isbn ? normaliseIsbn(fields.isbn) : null } : {}) },
      });
      if (levelIds !== undefined) {
        await db.libraryBookLevel.deleteMany({ where: { bookId: id } });
        if (levelIds.length > 0) {
          await db.libraryBookLevel.createMany({ data: [...new Set(levelIds)].map((classLevelId) => ({ schoolId: authCtx.schoolId, bookId: id, classLevelId })) });
        }
      }
      await audit(db, authCtx, req, AUDIT.book, id, { op: "update" });
      return this.readBook(db, authCtx.schoolId, id);
    });
  }

  /** Only a book never lent: its loans are the library's history. Withdraw its copies instead. */
  async deleteBook(authCtx: AuthContext, id: string, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.libraryBook.findFirst({ where: { id, schoolId: authCtx.schoolId }, select: { id: true } });
      if (!existing) throw new NotFoundError("Book not found.");
      const loans = await db.libraryLoan.count({ where: { copy: { bookId: id } } });
      if (loans > 0) {
        throw new ConflictError("BOOK_HAS_LOANS", "This book has been lent before, so it stays in the records. Withdraw its copies instead.");
      }
      await db.libraryBook.delete({ where: { id } });
      await audit(db, authCtx, req, AUDIT.book, id, { op: "delete" });
    });
  }

  // ─── Copies ───────────────────────────────────────────────────────────────

  async addCopies(authCtx: AuthContext, bookId: string, input: AddCopiesInput, req: RequestContext): Promise<LibraryBookDto> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.libraryBook.findFirst({ where: { id: bookId, schoolId: authCtx.schoolId }, select: { id: true } });
      if (!existing) throw new NotFoundError("Book not found.");
      const added = await insertCopies(db, authCtx.schoolId, bookId, input);
      await audit(db, authCtx, req, AUDIT.copy, bookId, { op: "add", copies: added });
      return this.readBook(db, authCtx.schoolId, bookId);
    });
  }

  async updateCopy(authCtx: AuthContext, id: string, input: UpdateCopyInput, req: RequestContext): Promise<LibraryBookDto> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const copy = await lockCopy(db, authCtx.schoolId, { id });
      if (input.status !== undefined && input.status !== copy.status) {
        if (copy.status === "ON_LOAN") throw new ConflictError("COPY_ON_LOAN", "This copy is out on loan. Return it first.");
        if (copy.status === "LOST") throw new ConflictError("COPY_LOST", "This copy is marked lost.");
      }
      await db.libraryCopy.update({
        where: { id },
        data: { ...(input.status !== undefined ? { status: input.status } : {}), ...(input.note !== undefined ? { note: input.note } : {}) },
      });
      await audit(db, authCtx, req, AUDIT.copy, copy.book_id, { op: "update", copyId: id, status: input.status ?? copy.status });
      return this.readBook(db, authCtx.schoolId, copy.book_id);
    });
  }

  async lookupCopy(authCtx: AuthContext, accessionNumber: string): Promise<LibraryCopyLookupDto> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const copy = await db.libraryCopy.findFirst({
        where: { schoolId: authCtx.schoolId, accessionNumber: normaliseNumber(accessionNumber) },
        include: { book: { select: { id: true, title: true, authors: true, referenceOnly: true } } },
      });
      if (!copy) throw new NotFoundError("No copy has that number.");
      const settings = await readSettings(db, authCtx.schoolId);
      const loan = await db.libraryLoan.findFirst({ where: { copyId: copy.id, returnedAt: null }, include: LOAN_INCLUDE });
      const classes = loan?.studentId ? await classNames(db, [loan.studentId]) : new Map<string, string>();
      return {
        copy: { id: copy.id, accessionNumber: copy.accessionNumber, status: copy.status },
        book: copy.book,
        loan: loan ? loanDto(loan, settings, classes) : null,
      };
    });
  }

  // ─── Lending ──────────────────────────────────────────────────────────────

  async issue(authCtx: AuthContext, input: IssueLoanInput, req: RequestContext): Promise<LibraryLoanDto> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const today = lagosTodayIso();
      if (input.dueOn !== undefined && input.dueOn < today) {
        throw new ValidationError("DUE_DATE_PAST", "The due date cannot be in the past.");
      }
      const settings = await readSettings(db, authCtx.schoolId);
      const copy = await lockCopy(db, authCtx.schoolId, { accessionNumber: input.accessionNumber });
      const book = await db.libraryBook.findUniqueOrThrow({ where: { id: copy.book_id }, select: { referenceOnly: true } });
      if (book.referenceOnly) throw new ConflictError("REFERENCE_ONLY", "This book is for reference only and stays in the library.");
      if (copy.status !== "AVAILABLE") {
        throw new ConflictError("COPY_NOT_AVAILABLE", copy.status === "ON_LOAN" ? "This copy is already out on loan." : "This copy is not on the shelf.");
      }

      const kind: LibraryBorrowerKind = input.studentId ? "STUDENT" : "STAFF";
      await lockBorrower(db, authCtx.schoolId, kind, (input.studentId ?? input.userId)!);
      const out = await db.libraryLoan.count({
        where: { returnedAt: null, ...(kind === "STUDENT" ? { studentId: input.studentId } : { userId: input.userId }) },
      });
      const limit = kind === "STUDENT" ? settings.studentLimit : settings.staffLimit;
      if (out >= limit) {
        throw new ConflictError("LOAN_LIMIT", `This borrower already has ${out} of ${limit} books out. One must come back first.`);
      }

      const loan = await uniqueOr("COPY_NOT_AVAILABLE", "This copy is already out on loan.", () =>
        db.libraryLoan.create({
          data: {
            schoolId: authCtx.schoolId,
            copyId: copy.id,
            studentId: input.studentId ?? null,
            userId: input.userId ?? null,
            dueOn: dateOf(input.dueOn ?? addDaysIso(today, settings.loanDays)),
            issuedBy: authCtx.userId,
          },
          include: LOAN_INCLUDE,
        }),
      );
      await db.libraryCopy.update({ where: { id: copy.id }, data: { status: "ON_LOAN" } });
      await audit(db, authCtx, req, AUDIT.issue, loan.id, { copyId: copy.id, borrowerKind: kind, dueOn: isoOf(loan.dueOn) });
      return loanDto(loan, settings, await classNames(db, input.studentId ? [input.studentId] : []));
    });
  }

  async returnCopy(authCtx: AuthContext, input: ReturnLoanInput, req: RequestContext): Promise<LibraryLoanDto> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const settings = await readSettings(db, authCtx.schoolId);
      const copy = await lockCopy(db, authCtx.schoolId, { accessionNumber: input.accessionNumber });
      const open = await db.libraryLoan.findFirst({ where: { copyId: copy.id, returnedAt: null }, select: { id: true, dueOn: true } });
      if (!open) throw new ConflictError("NOT_ON_LOAN", "This copy is not out on loan.");
      const loan = await db.libraryLoan.update({
        where: { id: open.id },
        data: { returnedAt: new Date(), returnedBy: authCtx.userId },
        include: LOAN_INCLUDE,
      });
      await db.libraryCopy.update({ where: { id: copy.id }, data: { status: "AVAILABLE" } });
      await audit(db, authCtx, req, AUDIT.return, loan.id, { copyId: copy.id, daysLate: daysLate(isoOf(open.dueOn), lagosTodayIso()) });
      return loanDto(loan, settings, await classNames(db, loan.studentId ? [loan.studentId] : []));
    });
  }

  async renew(authCtx: AuthContext, loanId: string, req: RequestContext): Promise<LibraryLoanDto> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const settings = await readSettings(db, authCtx.schoolId);
      const rows = await db.$queryRaw<{ id: string; due_on: Date; renewals: number; returned_at: Date | null }[]>`
        SELECT id, due_on, renewals, returned_at FROM library_loans WHERE id = ${loanId} AND school_id = ${authCtx.schoolId} FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new NotFoundError("Loan not found.");
      if (current.returned_at) throw new ConflictError("NOT_ON_LOAN", "This book has already been returned.");
      const today = lagosTodayIso();
      const dueOn = isoOf(current.due_on);
      if (dueOn < today) throw new ConflictError("LOAN_OVERDUE", "This book is overdue. Return it first, then lend it again.");
      if (current.renewals >= settings.renewalLimit) {
        throw new ConflictError("RENEWAL_LIMIT", "This loan has been renewed as many times as the school allows.");
      }
      const next = addDaysIso(today, settings.loanDays);
      const loan = await db.libraryLoan.update({
        where: { id: loanId },
        data: { dueOn: dateOf(next > dueOn ? next : dueOn), renewals: { increment: 1 } },
        include: LOAN_INCLUDE,
      });
      await audit(db, authCtx, req, AUDIT.renew, loanId, { renewals: loan.renewals, dueOn: isoOf(loan.dueOn) });
      return loanDto(loan, settings, await classNames(db, loan.studentId ? [loan.studentId] : []));
    });
  }

  async listLoans(authCtx: AuthContext, query: ListLoansInput): Promise<LibraryLoanDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const settings = await readSettings(db, authCtx.schoolId);
      const today = dateOf(lagosTodayIso());
      const q = query.q?.trim();
      const rows = await db.libraryLoan.findMany({
        where: {
          schoolId: authCtx.schoolId,
          ...(query.state === "RETURNED" ? { returnedAt: { not: null } } : { returnedAt: null }),
          ...(query.state === "OVERDUE" ? { dueOn: { lt: today } } : {}),
          ...(q
            ? {
                OR: [
                  { copy: { book: { title: { contains: q, mode: "insensitive" } } } },
                  { copy: { accessionNumber: q.toUpperCase() } },
                  { student: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { admissionNumber: { contains: q, mode: "insensitive" } }] } },
                  { user: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } },
                ],
              }
            : {}),
        },
        include: LOAN_INCLUDE,
        orderBy: query.state === "RETURNED" ? { returnedAt: "desc" } : { dueOn: "asc" },
        take: 500,
      });
      const classes = await classNames(db, rows.flatMap((r) => (r.studentId ? [r.studentId] : [])));
      return rows.map((r) => loanDto(r, settings, classes));
    });
  }

  async studentLoans(authCtx: AuthContext, studentId: string): Promise<LibraryBorrowerLoansDto> {
    return this.borrowerLoans(authCtx, "STUDENT", studentId);
  }

  async staffLoans(authCtx: AuthContext, userId: string): Promise<LibraryBorrowerLoansDto> {
    return this.borrowerLoans(authCtx, "STAFF", userId);
  }

  // ─── Borrowers ────────────────────────────────────────────────────────────

  /** Names, admission number and class, or "Staff": nothing else about anyone. */
  async findBorrowers(authCtx: AuthContext, query: ListBorrowersInput): Promise<LibraryBorrowerDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const settings = await readSettings(db, authCtx.schoolId);
      const q = query.q.trim();
      if (query.kind === "STUDENT") {
        const rows = await db.student.findMany({
          where: {
            schoolId: authCtx.schoolId,
            status: "ACTIVE",
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { admissionNumber: { contains: q, mode: "insensitive" } },
            ],
          },
          select: { id: true, firstName: true, lastName: true, admissionNumber: true, _count: { select: { libraryLoans: { where: { returnedAt: null } } } } },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: 20,
        });
        const classes = await classNames(db, rows.map((r) => r.id));
        return rows.map((r) => ({
          kind: "STUDENT" as const,
          id: r.id,
          name: `${r.firstName} ${r.lastName}`,
          detail: studentDetail(r.admissionNumber, classes.get(r.id)),
          booksOut: r._count.libraryLoans,
          limit: settings.studentLimit,
        }));
      }
      const rows = await db.user.findMany({
        where: {
          schoolId: authCtx.schoolId,
          isActive: true,
          OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }],
        },
        select: { id: true, firstName: true, lastName: true, _count: { select: { libraryLoans: { where: { returnedAt: null } } } } },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: 20,
      });
      return rows.map((r) => ({
        kind: "STAFF" as const,
        id: r.id,
        name: `${r.firstName} ${r.lastName}`,
        detail: "Staff",
        booksOut: r._count.libraryLoans,
        limit: settings.staffLimit,
      }));
    });
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async borrowerLoans(authCtx: AuthContext, kind: LibraryBorrowerKind, id: string): Promise<LibraryBorrowerLoansDto> {
    await assertUserActiveAndHasOneOf(authCtx, LIBRARY_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const settings = await readSettings(db, authCtx.schoolId);
      const rows = await db.libraryLoan.findMany({
        where: { schoolId: authCtx.schoolId, returnedAt: null, ...(kind === "STUDENT" ? { studentId: id } : { userId: id }) },
        include: LOAN_INCLUDE,
        orderBy: { dueOn: "asc" },
      });
      const classes = kind === "STUDENT" ? await classNames(db, [id]) : new Map<string, string>();
      return { loans: rows.map((r) => loanDto(r, settings, classes)), limit: kind === "STUDENT" ? settings.studentLimit : settings.staffLimit };
    });
  }

  private async readBook(db: Db, schoolId: string, id: string): Promise<LibraryBookDto> {
    const row = await db.libraryBook.findFirst({ where: { id, schoolId }, include: BOOK_INCLUDE });
    if (!row) throw new NotFoundError("Book not found.");
    const settings = await readSettings(db, schoolId);
    const openLoans = await db.libraryLoan.findMany({
      where: { returnedAt: null, copyId: { in: row.copies.map((c) => c.id) } },
      include: LOAN_INCLUDE,
    });
    const classes = await classNames(db, openLoans.flatMap((l) => (l.studentId ? [l.studentId] : [])));
    const loanByCopy = new Map(openLoans.map((l) => [l.copyId, loanDto(l, settings, classes)]));
    const everLent = await db.libraryLoan.count({ where: { copy: { bookId: id } } });
    return {
      ...bookSummaryDto(row),
      publisher: row.publisher,
      publishedYear: row.publishedYear,
      subjectId: row.subjectId,
      replacementPrice: row.replacementPrice,
      levels: [...row.levels].sort((a, b) => a.classLevel.orderIndex - b.classLevel.orderIndex).map((l) => ({ id: l.classLevel.id, name: l.classLevel.name })),
      copyList: row.copies.map((c) => ({
        id: c.id,
        accessionNumber: c.accessionNumber,
        status: c.status,
        note: c.note,
        loan: loanByCopy.get(c.id) ?? null,
      })),
      hasLoans: everLent > 0,
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normaliseNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

async function readSettings(db: Db, schoolId: string): Promise<LibrarySettingsDto> {
  const row = await db.librarySettings.findUnique({ where: { schoolId } });
  return row ? settingsDto(row) : { ...DEFAULT_SETTINGS };
}

function settingsDto(row: LibrarySettingsDto): LibrarySettingsDto {
  return { loanDays: row.loanDays, studentLimit: row.studentLimit, staffLimit: row.staffLimit, renewalLimit: row.renewalLimit, nextAccession: row.nextAccession };
}

/**
 * Adds copies with the given accession numbers, or `count` copies numbered from
 * the school's next number (skipping any number already used). The settings row
 * is locked while numbering, so two librarians adding copies at once never hand
 * out the same number.
 */
async function insertCopies(db: Db, schoolId: string, bookId: string, input: AddCopiesInput): Promise<number> {
  let numbers: string[];
  if (input.accessionNumbers) {
    numbers = input.accessionNumbers.map(normaliseNumber);
    const taken = await db.libraryCopy.findMany({ where: { schoolId, accessionNumber: { in: numbers } }, select: { accessionNumber: true } });
    if (taken.length > 0) {
      throw new ConflictError("ACCESSION_TAKEN", `Accession number ${taken.map((t) => t.accessionNumber).join(", ")} is already used.`);
    }
  } else {
    await db.librarySettings.upsert({ where: { schoolId }, create: { schoolId }, update: {} });
    const [locked] = await db.$queryRaw<{ next_accession: number }[]>`
      SELECT next_accession FROM library_settings WHERE school_id = ${schoolId} FOR UPDATE
    `;
    let next = locked!.next_accession;
    numbers = [];
    while (numbers.length < input.count!) {
      const batch = Array.from({ length: input.count! - numbers.length }, (_, i) => String(next + i));
      const taken = new Set(
        (await db.libraryCopy.findMany({ where: { schoolId, accessionNumber: { in: batch } }, select: { accessionNumber: true } })).map((t) => t.accessionNumber),
      );
      numbers.push(...batch.filter((b) => !taken.has(b)));
      next += batch.length;
    }
    await db.librarySettings.update({ where: { schoolId }, data: { nextAccession: next } });
  }
  await uniqueOr("ACCESSION_TAKEN", "One of those accession numbers is already used.", () =>
    db.libraryCopy.createMany({ data: numbers.map((accessionNumber) => ({ schoolId, bookId, accessionNumber })) }),
  );
  return numbers.length;
}

/** Locks a copy row for the rest of the transaction. */
async function lockCopy(
  db: Db,
  schoolId: string,
  by: { id: string } | { accessionNumber: string },
): Promise<{ id: string; book_id: string; status: "AVAILABLE" | "ON_LOAN" | "LOST" | "WITHDRAWN" }> {
  const rows =
    "id" in by
      ? await db.$queryRaw<{ id: string; book_id: string; status: "AVAILABLE" | "ON_LOAN" | "LOST" | "WITHDRAWN" }[]>`
          SELECT id, book_id, status::text AS status FROM library_copies WHERE id = ${by.id} AND school_id = ${schoolId} FOR UPDATE
        `
      : await db.$queryRaw<{ id: string; book_id: string; status: "AVAILABLE" | "ON_LOAN" | "LOST" | "WITHDRAWN" }[]>`
          SELECT id, book_id, status::text AS status FROM library_copies
          WHERE accession_number = ${normaliseNumber(by.accessionNumber)} AND school_id = ${schoolId} FOR UPDATE
        `;
  if (rows.length === 0) throw new NotFoundError("No copy has that number.");
  return rows[0]!;
}

/** Locks the borrower's row, so their limit holds under concurrent lending. */
async function lockBorrower(db: Db, schoolId: string, kind: LibraryBorrowerKind, id: string): Promise<void> {
  if (kind === "STUDENT") {
    const rows = await db.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM students WHERE id = ${id} AND school_id = ${schoolId} FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundError("Student not found.");
    if (rows[0]!.status !== "ACTIVE") throw new ConflictError("BORROWER_NOT_ACTIVE", "This student has left the school.");
    return;
  }
  const rows = await db.$queryRaw<{ is_active: boolean }[]>`
    SELECT is_active FROM users WHERE id = ${id} AND school_id = ${schoolId} FOR UPDATE
  `;
  if (rows.length === 0) throw new NotFoundError("Staff member not found.");
  if (!rows[0]!.is_active) throw new ConflictError("BORROWER_NOT_ACTIVE", "This member of staff's account is switched off.");
}

async function assertSubjectAndLevels(db: Db, schoolId: string, subjectId: string | null, levelIds: string[]): Promise<void> {
  if (subjectId) {
    const found = await db.subject.count({ where: { id: subjectId, schoolId } });
    if (found === 0) throw new ValidationError("UNKNOWN_SUBJECT", "That subject is not in this school.");
  }
  const unique = [...new Set(levelIds)];
  if (unique.length > 0) {
    const found = await db.classLevel.count({ where: { id: { in: unique }, schoolId } });
    if (found !== unique.length) throw new ValidationError("UNKNOWN_CLASS_LEVEL", "A class level is not in this school.");
  }
}

/** Each student's class this term, by name. */
async function classNames(db: Db, studentIds: string[]): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();
  const term = await db.term.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!term) return new Map();
  const rows = await db.enrollment.findMany({
    where: { studentId: { in: [...new Set(studentIds)] }, termId: term.id, status: "ENROLLED" },
    select: { studentId: true, classArm: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.studentId, r.classArm.name]));
}

function studentDetail(admissionNumber: string, className: string | undefined): string {
  return className ? `${admissionNumber} · ${className}` : admissionNumber;
}

function bookSummaryDto(row: BookRow): LibraryBookSummaryDto {
  const inStock = row.copies.filter((c) => c.status === "AVAILABLE" || c.status === "ON_LOAN");
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    isbn: row.isbn,
    subjectName: row.subject?.name ?? null,
    shelfLocation: row.shelfLocation,
    referenceOnly: row.referenceOnly,
    copies: inStock.length,
    available: inStock.filter((c) => c.status === "AVAILABLE").length,
  };
}

function loanDto(row: LoanRow, settings: LibrarySettingsDto, classes: Map<string, string>): LibraryLoanDto {
  const dueOn = isoOf(row.dueOn);
  const late = row.returnedAt ? 0 : daysLate(dueOn, lagosTodayIso());
  const borrower = row.student
    ? { kind: "STUDENT" as const, id: row.student.id, name: `${row.student.firstName} ${row.student.lastName}`, detail: studentDetail(row.student.admissionNumber, classes.get(row.student.id)) }
    : { kind: "STAFF" as const, id: row.user!.id, name: `${row.user!.firstName} ${row.user!.lastName}`, detail: "Staff" };
  return {
    id: row.id,
    copyId: row.copy.id,
    accessionNumber: row.copy.accessionNumber,
    bookId: row.copy.book.id,
    title: row.copy.book.title,
    borrower,
    issuedAt: row.issuedAt.toISOString(),
    dueOn,
    renewals: row.renewals,
    renewalsLeft: Math.max(0, settings.renewalLimit - row.renewals),
    returnedAt: row.returnedAt?.toISOString() ?? null,
    overdue: late > 0,
    daysLate: late,
  };
}

/** Whole calendar days after the due date; 0 on or before it. */
function daysLate(dueOn: string, today: string): number {
  return Math.max(0, Math.round((dateOf(today).getTime() - dateOf(dueOn).getTime()) / 86_400_000));
}

function dateOf(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function uniqueOr<T>(code: string, message: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictError(code, message);
    throw e;
  }
}

async function audit(
  db: Db,
  authCtx: AuthContext,
  req: RequestContext,
  action: string,
  entityId: string,
  metadata: Record<string, string | number | null>,
) {
  await db.auditLog.create({
    data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action, entityType: "library", entityId, ipAddress: req.ipAddress, metadata },
  });
}
