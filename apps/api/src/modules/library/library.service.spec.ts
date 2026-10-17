import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { addDaysIso, ConflictError, ForbiddenError, lagosTodayIso, NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { LibraryService } from "./library.service";

// Phase 9 / CP6.1 — the library's catalogue and lending (docs/modules/phase-9.md
// §14 CP6-D1/D2/D8), against real Postgres. The lending rules first: one open
// loan per copy (two librarians at once, exactly one wins), reference books and
// copies that are not on the shelf are refused, each borrower kind has its own
// limit, renewals stop at the limit and once a book is overdue. Then accession
// numbers, deleting, and who may do what.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

async function makeSchool(label: string) {
  const signed = await new AuthService().signupOwner(
    {
      schoolName: `Library ${label} ${runId}`,
      schoolSlug: `library-${label}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `library-${label}-${runId}@example.test`,
      ownerPhone: `+23496${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
  return { schoolId: signed.school.id, ownerId: signed.user.id };
}

interface Fixture {
  schoolId: string;
  ownerId: string;
  adminId: string;
  librarianId: string;
  teacherId: string;
  bursarId: string;
  yearId: string;
  termId: string;
  armId: string;
  levelId: string;
}

describe("LibraryService (integration)", () => {
  const library = new LibraryService();
  const schoolIds = new Set<string>();
  let A: Fixture;
  let B: Fixture;
  let n = 0;

  async function setUp(label: string): Promise<Fixture> {
    const s = await makeSchool(label);
    schoolIds.add(s.schoolId);
    const schoolId = s.schoolId;
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: day("2025-09-01"), endDate: day("2099-07-31") },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "This Term", startDate: day("2025-09-01"), endDate: day("2098-12-31"), isCurrent: true },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS 1 Gold", code: `lb-${label}-${runId}` } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staff = async (key: string) => {
        const user = await db.user.create({ data: { schoolId, email: `lb-${label}-${key}-${runId}@example.test`, firstName: key, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(key) } });
        return user.id;
      };
      return {
        schoolId,
        ownerId: s.ownerId,
        adminId: await staff("admin"),
        librarianId: await staff("librarian"),
        teacherId: await staff("teacher"),
        bursarId: await staff("bursar"),
        yearId: year.id,
        termId: term.id,
        armId: arm.id,
        levelId: level.id,
      };
    });
  }

  async function student(f: Fixture, status: "ACTIVE" | "WITHDRAWN" = "ACTIVE"): Promise<string> {
    n += 1;
    return withTenant(f.schoolId, async (db) => {
      const s = await db.student.create({
        data: { schoolId: f.schoolId, admissionNumber: `LB-${n}-${runId}`, firstName: "Ada", lastName: `Reader${n}`, dateOfBirth: day("2013-01-01"), gender: "FEMALE", status },
      });
      await db.enrollment.create({ data: { schoolId: f.schoolId, studentId: s.id, termId: f.termId, academicYearId: f.yearId, classArmId: f.armId, status: "ENROLLED" } });
      return s.id;
    });
  }

  const librarian = (f: Fixture) => ctx(f.schoolId, f.librarianId);

  /** A book with `copies` copies, numbered A<n>-1, A<n>-2 … */
  async function book(f: Fixture, copies = 1, opts: { referenceOnly?: boolean } = {}) {
    n += 1;
    const accessionNumbers = Array.from({ length: copies }, (_, i) => `B${n}-${i + 1}-${runId}`);
    const b = await library.createBook(
      librarian(f),
      { title: `Things Fall Apart ${n}`, authors: "Chinua Achebe", referenceOnly: opts.referenceOnly ?? false, copies: { accessionNumbers } },
      reqCtx,
    );
    return { ...b, accessionNumbers: accessionNumbers.map((a) => a.toUpperCase()) };
  }

  beforeAll(async () => {
    A = await setUp("a");
    B = await setUp("b");
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  // ── Lending ──────────────────────────────────────────────────────────────

  describe("issuing and returning", () => {
    it("lends a copy for the school's loan period and puts it back on the shelf on return", async () => {
      const b = await book(A, 2);
      const kid = await student(A);
      const loan = await library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!.toLowerCase(), studentId: kid }, reqCtx);
      expect(loan).toMatchObject({
        title: b.title,
        accessionNumber: b.accessionNumbers[0],
        dueOn: addDaysIso(lagosTodayIso(), 14),
        renewals: 0,
        renewalsLeft: 2,
        overdue: false,
        returnedAt: null,
        borrower: { kind: "STUDENT", id: kid, detail: expect.stringContaining("JSS 1 Gold") },
      });
      const after = await library.getBook(librarian(A), b.id);
      expect(after).toMatchObject({ copies: 2, available: 1, hasLoans: true });
      expect(after.copyList.find((c) => c.accessionNumber === b.accessionNumbers[0])).toMatchObject({ status: "ON_LOAN", loan: { id: loan.id } });

      const returned = await library.returnCopy(librarian(A), { accessionNumber: b.accessionNumbers[0]! }, reqCtx);
      expect(returned.returnedAt).not.toBeNull();
      expect((await library.getBook(librarian(A), b.id)).available).toBe(2);
      // A copy on the shelf cannot be returned.
      await expect(library.returnCopy(librarian(A), { accessionNumber: b.accessionNumbers[0]! }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
    });

    it("takes a due date the librarian sets, but not one in the past", async () => {
      const b = await book(A);
      const kid = await student(A);
      const due = addDaysIso(lagosTodayIso(), 3);
      await expect(library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: kid, dueOn: due }, reqCtx)).resolves.toMatchObject({ dueOn: due });
      const b2 = await book(A);
      await expect(
        library.issue(librarian(A), { accessionNumber: b2.accessionNumbers[0]!, studentId: kid, dueOn: addDaysIso(lagosTodayIso(), -1) }, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("refuses a reference book, a copy already out, a withdrawn copy, and an unknown number", async () => {
      const kid = await student(A);
      const ref = await book(A, 1, { referenceOnly: true });
      await expect(library.issue(librarian(A), { accessionNumber: ref.accessionNumbers[0]!, studentId: kid }, reqCtx)).rejects.toMatchObject({ code: "REFERENCE_ONLY" });

      const b = await book(A, 2);
      await library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: kid }, reqCtx);
      await expect(library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: await student(A) }, reqCtx)).rejects.toMatchObject({ code: "COPY_NOT_AVAILABLE" });
      // A copy on loan cannot be withdrawn.
      const onLoan = (await library.getBook(librarian(A), b.id)).copyList.find((c) => c.status === "ON_LOAN")!;
      await expect(library.updateCopy(librarian(A), onLoan.id, { status: "WITHDRAWN" }, reqCtx)).rejects.toBeInstanceOf(ConflictError);

      const shelf = (await library.getBook(librarian(A), b.id)).copyList.find((c) => c.status === "AVAILABLE")!;
      await library.updateCopy(librarian(A), shelf.id, { status: "WITHDRAWN", note: "Torn cover" }, reqCtx);
      await expect(library.issue(librarian(A), { accessionNumber: shelf.accessionNumber, studentId: await student(A) }, reqCtx)).rejects.toMatchObject({ code: "COPY_NOT_AVAILABLE" });

      await expect(library.issue(librarian(A), { accessionNumber: `NOPE-${runId}`, studentId: kid }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("lends one copy to exactly one of two librarians working at once", async () => {
      const b = await book(A);
      const [k1, k2] = [await student(A), await student(A)];
      const results = await Promise.allSettled([
        library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: k1 }, reqCtx),
        library.issue(ctx(A.schoolId, A.adminId), { accessionNumber: b.accessionNumbers[0]!, studentId: k2 }, reqCtx),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictError);
      const open = await withTenant(A.schoolId, (db) =>
        db.libraryLoan.count({ where: { copy: { accessionNumber: b.accessionNumbers[0]! }, returnedAt: null } }),
      );
      expect(open).toBe(1);
    });

    it("holds each kind of borrower to their own limit", async () => {
      const b = await book(A, 8);
      const kid = await student(A);
      await library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: kid }, reqCtx);
      await library.issue(librarian(A), { accessionNumber: b.accessionNumbers[1]!, studentId: kid }, reqCtx);
      await expect(library.issue(librarian(A), { accessionNumber: b.accessionNumbers[2]!, studentId: kid }, reqCtx)).rejects.toMatchObject({ code: "LOAN_LIMIT" });
      // Staff take up to five.
      for (const a of b.accessionNumbers.slice(2, 7)) await library.issue(librarian(A), { accessionNumber: a, userId: A.teacherId }, reqCtx);
      await expect(library.issue(librarian(A), { accessionNumber: b.accessionNumbers[7]!, userId: A.teacherId }, reqCtx)).rejects.toMatchObject({ code: "LOAN_LIMIT" });
      // Returning one frees a place.
      await library.returnCopy(librarian(A), { accessionNumber: b.accessionNumbers[0]! }, reqCtx);
      await expect(library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: kid }, reqCtx)).resolves.toBeTruthy();
      const out = await library.studentLoans(librarian(A), kid);
      expect(out).toMatchObject({ limit: 2 });
      expect(out.loans).toHaveLength(2);
      expect((await library.staffLoans(librarian(A), A.teacherId)).loans).toHaveLength(5);
    });

    it("does not lend to a student who has left or to another school's borrower", async () => {
      const b = await book(A);
      await expect(library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: await student(A, "WITHDRAWN") }, reqCtx)).rejects.toMatchObject({ code: "BORROWER_NOT_ACTIVE" });
      await expect(library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: await student(B) }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
      await expect(library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, userId: B.teacherId }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("renewals and the overdue list", () => {
    it("renews before the due date up to the limit, and never once a book is overdue", async () => {
      const b = await book(A, 2);
      const kid = await student(A);
      const loan = await library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: kid, dueOn: addDaysIso(lagosTodayIso(), 2) }, reqCtx);
      const once = await library.renew(librarian(A), loan.id, reqCtx);
      expect(once).toMatchObject({ renewals: 1, renewalsLeft: 1, dueOn: addDaysIso(lagosTodayIso(), 14) });
      // A second renewal on the same day keeps the later date.
      const twice = await library.renew(librarian(A), loan.id, reqCtx);
      expect(twice).toMatchObject({ renewals: 2, renewalsLeft: 0, dueOn: addDaysIso(lagosTodayIso(), 14) });
      await expect(library.renew(librarian(A), loan.id, reqCtx)).rejects.toMatchObject({ code: "RENEWAL_LIMIT" });

      const late = await library.issue(librarian(A), { accessionNumber: b.accessionNumbers[1]!, studentId: kid }, reqCtx);
      await withTenant(A.schoolId, (db) => db.libraryLoan.update({ where: { id: late.id }, data: { dueOn: day(addDaysIso(lagosTodayIso(), -3)) } }));
      await expect(library.renew(librarian(A), late.id, reqCtx)).rejects.toMatchObject({ code: "LOAN_OVERDUE" });

      const overdue = await library.listLoans(librarian(A), { state: "OVERDUE" });
      expect(overdue.find((l) => l.id === late.id)).toMatchObject({ overdue: true, daysLate: 3 });
      expect(overdue.some((l) => l.id === loan.id)).toBe(false);
      const open = await library.listLoans(librarian(A), { state: "OPEN" });
      expect(open.some((l) => l.id === loan.id)).toBe(true);
    });
  });

  // ── Catalogue ────────────────────────────────────────────────────────────

  describe("books and copies", () => {
    it("numbers copies from the school's next number, skipping numbers already used", async () => {
      // A fresh school starts at 1.
      const C = await setUp("c");
      const lib = librarian(C);
      await library.createBook(lib, { title: "Typed", copies: { accessionNumbers: ["2"] } }, reqCtx);
      const auto = await library.createBook(lib, { title: "Numbered", copies: { count: 3 } }, reqCtx);
      expect(auto.copyList.map((c) => c.accessionNumber).sort()).toEqual(["1", "3", "4"]);
      expect((await library.context(lib)).settings.nextAccession).toBe(5);
      await expect(library.addCopies(lib, auto.id, { accessionNumbers: ["3"] }, reqCtx)).rejects.toMatchObject({ code: "ACCESSION_TAKEN" });
    });

    it("keeps ISBNs digits only, levels and subject within the school", async () => {
      const subject = await withTenant(A.schoolId, (db) => db.subject.create({ data: { schoolId: A.schoolId, name: `Literature ${runId}`, code: `lit-${runId}` } }));
      const b = await library.createBook(
        librarian(A),
        { title: "Purple Hibiscus", isbn: "978-0-00-718988-5", subjectId: subject.id, levelIds: [A.levelId], replacementPrice: 450_000, shelfLocation: "Fiction B" },
        reqCtx,
      );
      expect(b).toMatchObject({ isbn: "9780007189885", subjectName: subject.name, replacementPrice: 450_000, copies: 0, levels: [{ id: A.levelId }] });
      await expect(library.createBook(librarian(A), { title: "X", levelIds: [B.levelId] }, reqCtx)).rejects.toBeInstanceOf(ValidationError);
      const found = await library.listBooks(librarian(A), { q: "9780007189885" });
      expect(found.map((x) => x.id)).toEqual([b.id]);
      const updated = await library.updateBook(librarian(A), b.id, { levelIds: [], subjectId: null, title: "Purple Hibiscus (2nd)" }, reqCtx);
      expect(updated).toMatchObject({ levels: [], subjectId: null, title: "Purple Hibiscus (2nd)" });
    });

    it("deletes a book never lent, and refuses one that has been", async () => {
      const fresh = await book(A, 2);
      await library.deleteBook(librarian(A), fresh.id, reqCtx);
      await expect(library.getBook(librarian(A), fresh.id)).rejects.toBeInstanceOf(NotFoundError);

      const lent = await book(A);
      await library.issue(librarian(A), { accessionNumber: lent.accessionNumbers[0]!, studentId: await student(A) }, reqCtx);
      await library.returnCopy(librarian(A), { accessionNumber: lent.accessionNumbers[0]! }, reqCtx);
      await expect(library.deleteBook(librarian(A), lent.id, reqCtx)).rejects.toMatchObject({ code: "BOOK_HAS_LOANS" });
    });

    it("looks a copy up by its number, with the loan it is on", async () => {
      const b = await book(A);
      const kid = await student(A);
      await library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: kid }, reqCtx);
      const found = await library.lookupCopy(librarian(A), b.accessionNumbers[0]!.toLowerCase());
      expect(found).toMatchObject({ copy: { status: "ON_LOAN" }, book: { title: b.title }, loan: { borrower: { id: kid } } });
      await expect(library.lookupCopy(librarian(B), b.accessionNumbers[0]!)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("borrowers", () => {
    it("finds students with their class and staff, with the books each has out", async () => {
      const kid = await student(A);
      const b = await book(A);
      await library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: kid }, reqCtx);
      const admission = await withTenant(A.schoolId, (db) => db.student.findUniqueOrThrow({ where: { id: kid }, select: { admissionNumber: true } }));
      const students = await library.findBorrowers(librarian(A), { kind: "STUDENT", q: admission.admissionNumber });
      expect(students).toEqual([
        { kind: "STUDENT", id: kid, name: expect.stringContaining("Ada"), detail: `${admission.admissionNumber} · JSS 1 Gold`, booksOut: 1, limit: 2 },
      ]);
      const staff = await library.findBorrowers(librarian(A), { kind: "STAFF", q: "teacher" });
      expect(staff.map((s) => s.id)).toContain(A.teacherId);
      expect(staff.every((s) => s.detail === "Staff" && s.limit === 5)).toBe(true);
      // Another school's people are not found.
      expect(await library.findBorrowers(librarian(B), { kind: "STUDENT", q: admission.admissionNumber })).toEqual([]);
    });
  });

  // ── Who ──────────────────────────────────────────────────────────────────

  describe("who may do what", () => {
    it("lets the librarian lend but only the owner and admin change the rules", async () => {
      await expect(library.updateSettings(librarian(A), { loanDays: 7 }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      const C = await setUp("d");
      const updated = await library.updateSettings(ctx(C.schoolId, C.adminId), { loanDays: 7, studentLimit: 1 }, reqCtx);
      expect(updated).toMatchObject({ loanDays: 7, studentLimit: 1, staffLimit: 5, renewalLimit: 2 });
      const b = await library.createBook(librarian(C), { title: "Week loan", copies: { count: 1 } }, reqCtx);
      n += 1;
      const kid = await withTenant(C.schoolId, async (db) =>
        (await db.student.create({ data: { schoolId: C.schoolId, admissionNumber: `LBD-${n}`, firstName: "Obi", lastName: "Reader", dateOfBirth: day("2013-01-01"), gender: "MALE" } })).id,
      );
      const loan = await library.issue(librarian(C), { accessionNumber: b.copyList[0]!.accessionNumber, studentId: kid }, reqCtx);
      expect(loan.dueOn).toBe(addDaysIso(lagosTodayIso(), 7));
      await expect(library.updateSettings(ctx(C.schoolId, C.ownerId), { renewalLimit: 0 }, reqCtx)).resolves.toMatchObject({ renewalLimit: 0 });
    });

    it("refuses teachers and the bursar on every library read and write", async () => {
      const b = await book(A);
      for (const userId of [A.teacherId, A.bursarId]) {
        const c = ctx(A.schoolId, userId);
        await expect(library.listBooks(c, {})).rejects.toBeInstanceOf(ForbiddenError);
        await expect(library.getBook(c, b.id)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(library.createBook(c, { title: "No" }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(library.issue(c, { accessionNumber: b.accessionNumbers[0]!, userId }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(library.listLoans(c, { state: "OPEN" })).rejects.toBeInstanceOf(ForbiddenError);
        await expect(library.findBorrowers(c, { kind: "STUDENT", q: "a" })).rejects.toBeInstanceOf(ForbiddenError);
      }
    });

    it("keeps one school's books out of another's sight", async () => {
      const b = await book(A);
      await expect(library.getBook(librarian(B), b.id)).rejects.toBeInstanceOf(NotFoundError);
      expect((await library.listBooks(librarian(B), { q: b.title })).length).toBe(0);
      await expect(library.deleteBook(librarian(B), b.id, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("records every change in the audit log, with ids and no names", async () => {
      const b = await book(A);
      const kid = await student(A);
      const loan = await library.issue(librarian(A), { accessionNumber: b.accessionNumbers[0]!, studentId: kid }, reqCtx);
      await library.returnCopy(librarian(A), { accessionNumber: b.accessionNumbers[0]! }, reqCtx);
      const rows = await withTenant(A.schoolId, (db) =>
        db.auditLog.findMany({ where: { entityType: "library", entityId: { in: [b.id, loan.id] } }, orderBy: { createdAt: "asc" } }),
      );
      expect(rows.map((r) => r.action)).toEqual(["library.book", "library.loan.issue", "library.loan.return"]);
      expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain("Ada");
    });
  });
});
