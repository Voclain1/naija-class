import { Injectable } from "@nestjs/common";

import { basePrisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type IdCardHolderKindDto,
  type IdCardHolderListDto,
  type IdCardHolderRowDto,
  type IdCardSchoolDto,
  type IdCardStatusDto,
  type IdCardVerdictDto,
  type IdCardVerificationDto,
  type IssueIdCardsInput,
  type IssueIdCardsResultDto,
  type ListIdCardsQuery,
  type MyIdCardDto,
  type PrintIdCardsDto,
  type PrintableIdCardDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { getActiveUserRoleKeys, userHoldsPermission } from "../../common/auth/role-check.js";
import { portalBaseUrl } from "../../common/portal-url.js";
import { signSchoolLogoUrl } from "../../common/storage/school-logo.js";
import { StorageService } from "../../common/storage/storage.service.js";
import { idCardToken, readIdCardToken } from "./id-card-token.js";

// ID cards (2026-10-19, docs/modules/id-cards-and-store.md §3).
//
// A card is a record: a running number per school, the academic session it is
// valid for, and a status. At most one ACTIVE card per person per session (a
// partial unique index). Reissuing a lost card marks the old one REPLACED in
// the same transaction, so the old card's code reads "replaced" if it turns
// up. Every issue, cancellation and reissue is audited.
//
// What a card shows is the NDPR minimum (owner's answer 2): photo, name, class
// or role, admission or staff number, the session, the school's return
// details and the code. The public check shows only what the front shows.

const PHOTO_TTL_SECONDS = 60 * 60;
const PUBLIC_PHOTO_TTL_SECONDS = 5 * 60;

interface RequestContext {
  ipAddress: string | null;
}

type CardRow = {
  id: string;
  holderKind: IdCardHolderKindDto;
  studentId: string | null;
  userId: string | null;
  academicYearId: string;
  cardNumber: string;
  status: IdCardStatusDto;
  issuedAt: Date;
};

const CARD_SELECT = {
  id: true,
  holderKind: true,
  studentId: true,
  userId: true,
  academicYearId: true,
  cardNumber: true,
  status: true,
  issuedAt: true,
} as const;

async function assertHolds(authCtx: AuthContext, permission: string): Promise<void> {
  await getActiveUserRoleKeys(authCtx);
  if (!(await userHoldsPermission(authCtx, permission))) {
    throw new ForbiddenError("You do not have permission to do that.");
  }
}

/** Today's date in Lagos (UTC+1, no daylight saving), as YYYY-MM-DD. */
export function lagosToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** What a scan of the card says. */
export function verdictFor(status: IdCardStatusDto, validUntil: string, today: string): IdCardVerdictDto {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "REPLACED") return "REPLACED";
  return today <= validUntil ? "VALID" : "EXPIRED";
}

/** The card number: the session's first year and the school's running count. */
export function formatCardNumber(yearStart: Date, sequence: number): string {
  return `ID-${yearStart.getUTCFullYear()}-${String(sequence).padStart(5, "0")}`;
}

async function resolveYear(db: PrismaClient, academicYearId?: string) {
  const year = academicYearId
    ? await db.academicYear.findUnique({ where: { id: academicYearId } })
    : await db.academicYear.findFirst({ where: { isCurrent: true } });
  return year;
}

function fullName(first: string, middle: string | null | undefined, last: string): string {
  return [first, middle, last].filter(Boolean).join(" ");
}

@Injectable()
export class IdCardsService {
  constructor(private readonly storage: StorageService) {}

  // ------------------------------------------------------------------ list

  async list(authCtx: AuthContext, query: ListIdCardsQuery): Promise<IdCardHolderListDto> {
    await assertHolds(authCtx, "id-card.read");
    return withTenant(authCtx.schoolId, async (db) => {
      const year = await resolveYear(db, query.academicYearId);
      if (query.academicYearId && !year) throw new NotFoundError("Session not found.");
      if (!year) return { academicYear: null, data: [] };
      const holders = query.kind === "STUDENT" ? await this.studentHolders(db, query.classArmId) : await this.staffHolders(db);
      const cards = await db.idCard.findMany({
        where: {
          academicYearId: year.id,
          status: "ACTIVE",
          holderKind: query.kind,
          ...(query.kind === "STUDENT"
            ? { studentId: { in: holders.map((h) => h.holderId) } }
            : { userId: { in: holders.map((h) => h.holderId) } }),
        },
        select: CARD_SELECT,
      });
      const byHolder = new Map(cards.map((c) => [(c.studentId ?? c.userId)!, c]));
      return {
        academicYear: { id: year.id, label: year.label },
        data: holders.map((h) => {
          const c = byHolder.get(h.holderId);
          return {
            ...h,
            card: c ? { id: c.id, cardNumber: c.cardNumber, status: c.status, issuedAt: c.issuedAt } : null,
          };
        }),
      };
    });
  }

  private async studentHolders(db: PrismaClient, classArmId?: string): Promise<Omit<IdCardHolderRowDto, "card">[]> {
    const enrollments = await db.enrollment.findMany({
      where: {
        term: { isCurrent: true },
        status: "ENROLLED",
        student: { status: "ACTIVE" },
        ...(classArmId ? { classArmId } : {}),
      },
      select: {
        classArm: { select: { name: true } },
        student: {
          select: { id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true, photoUploadedAt: true },
        },
      },
      orderBy: [{ classArm: { name: "asc" } }, { student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
    });
    return enrollments.map((e) => ({
      holderId: e.student.id,
      kind: "STUDENT" as const,
      name: fullName(e.student.firstName, e.student.middleName, e.student.lastName),
      number: e.student.admissionNumber,
      detail: e.classArm.name,
      hasPhoto: e.student.photoUploadedAt !== null,
    }));
  }

  private async staffHolders(db: PrismaClient): Promise<Omit<IdCardHolderRowDto, "card">[]> {
    const users = await db.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        photoUploadedAt: true,
        teacherProfile: { select: { staffNumber: true } },
        roles: { select: { role: { select: { name: true } } } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    return users.map((u) => ({
      holderId: u.id,
      kind: "STAFF" as const,
      name: fullName(u.firstName, null, u.lastName),
      number: u.teacherProfile?.staffNumber ?? null,
      detail: u.roles.map((r) => r.role.name).join(", ") || null,
      hasPhoto: u.photoUploadedAt !== null,
    }));
  }

  // ----------------------------------------------------------------- issue

  async issue(authCtx: AuthContext, input: IssueIdCardsInput, reqCtx: RequestContext): Promise<IssueIdCardsResultDto> {
    await assertHolds(authCtx, "id-card.issue");
    return withTenant(authCtx.schoolId, async (db) => {
      const year = await resolveYear(db, input.academicYearId);
      if (!year) {
        throw new ValidationError("NO_CURRENT_SESSION", "Set the current session under Sessions & classes first.");
      }
      const ids = [...new Set(input.holderIds)];
      const known =
        input.kind === "STUDENT"
          ? (await db.student.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { id: true } })).map((s) => s.id)
          : (await db.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } })).map((u) => u.id);
      if (known.length !== ids.length) throw new NotFoundError("Some of those people were not found, or have left.");

      const existing = await db.idCard.findMany({
        where: {
          academicYearId: year.id,
          status: "ACTIVE",
          ...(input.kind === "STUDENT" ? { studentId: { in: ids } } : { userId: { in: ids } }),
        },
        select: { studentId: true, userId: true },
      });
      const holding = new Set(existing.map((c) => (c.studentId ?? c.userId)!));
      const toIssue = ids.filter((id) => !holding.has(id));
      if (toIssue.length > 0) {
        let next = await this.reserveNumbers(db, authCtx.schoolId);
        for (const holderId of toIssue) {
          const card = await db.idCard.create({
            data: {
              schoolId: authCtx.schoolId,
              holderKind: input.kind,
              studentId: input.kind === "STUDENT" ? holderId : null,
              userId: input.kind === "STAFF" ? holderId : null,
              academicYearId: year.id,
              cardNumber: formatCardNumber(year.startDate, next++),
              issuedBy: authCtx.userId,
            },
            select: { id: true, cardNumber: true },
          });
          await this.audit(db, authCtx, "id-card.issue", card.id, reqCtx, { kind: input.kind, cardNumber: card.cardNumber });
        }
      }
      return { issued: toIssue.length, skipped: ids.length - toIssue.length };
    });
  }

  /**
   * The next card number in the school's running count. Locks the school's
   * row first, so two issues at once queue rather than share a number.
   */
  private async reserveNumbers(db: PrismaClient, schoolId: string): Promise<number> {
    await db.$executeRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
    return (await db.idCard.count()) + 1;
  }

  async cancel(authCtx: AuthContext, cardId: string, reason: string, reqCtx: RequestContext): Promise<{ ok: true }> {
    await assertHolds(authCtx, "id-card.issue");
    return withTenant(authCtx.schoolId, async (db) => {
      const card = await this.activeCard(db, cardId);
      await db.idCard.update({
        where: { id: card.id },
        data: { status: "CANCELLED", endedAt: new Date(), endedBy: authCtx.userId, endReason: reason },
      });
      await this.audit(db, authCtx, "id-card.cancel", card.id, reqCtx, { cardNumber: card.cardNumber, reason });
      return { ok: true as const };
    });
  }

  /** A lost or damaged card: the old one is marked replaced and a new one issued for the same session. */
  async reissue(authCtx: AuthContext, cardId: string, reason: string, reqCtx: RequestContext): Promise<{ id: string }> {
    await assertHolds(authCtx, "id-card.issue");
    return withTenant(authCtx.schoolId, async (db) => {
      const card = await this.activeCard(db, cardId);
      const year = await db.academicYear.findUniqueOrThrow({ where: { id: card.academicYearId } });
      // End the old card first: the one-active-card index would refuse the new one otherwise.
      await db.idCard.update({
        where: { id: card.id },
        data: { status: "REPLACED", endedAt: new Date(), endedBy: authCtx.userId, endReason: reason },
      });
      const next = await this.reserveNumbers(db, authCtx.schoolId);
      const fresh = await db.idCard.create({
        data: {
          schoolId: authCtx.schoolId,
          holderKind: card.holderKind,
          studentId: card.studentId,
          userId: card.userId,
          academicYearId: card.academicYearId,
          cardNumber: formatCardNumber(year.startDate, next),
          issuedBy: authCtx.userId,
        },
        select: { id: true, cardNumber: true },
      });
      await db.idCard.update({ where: { id: card.id }, data: { replacedById: fresh.id } });
      await this.audit(db, authCtx, "id-card.reissue", fresh.id, reqCtx, {
        replaces: card.cardNumber,
        cardNumber: fresh.cardNumber,
        reason,
      });
      return { id: fresh.id };
    });
  }

  private async activeCard(db: PrismaClient, cardId: string): Promise<CardRow> {
    const card = await db.idCard.findUnique({ where: { id: cardId }, select: CARD_SELECT });
    if (!card) throw new NotFoundError("Card not found.");
    if (card.status !== "ACTIVE") throw new ValidationError("CARD_NOT_ACTIVE", "This card has already been cancelled or replaced.");
    return card;
  }

  // ----------------------------------------------------------------- print

  async print(authCtx: AuthContext, cardIds: string[]): Promise<PrintIdCardsDto> {
    await assertHolds(authCtx, "id-card.read");
    return withTenant(authCtx.schoolId, async (db) => {
      const cards = await db.idCard.findMany({ where: { id: { in: cardIds }, status: "ACTIVE" }, select: CARD_SELECT });
      if (cards.length !== new Set(cardIds).size) throw new NotFoundError("Some of those cards were not found or are no longer active.");
      const order = new Map(cardIds.map((id, i) => [id, i]));
      cards.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      return { school: await this.schoolFor(authCtx.schoolId), cards: await this.printable(db, authCtx.schoolId, cards) };
    });
  }

  // --------------------------------------------------- the holder's own card

  async mineAsStaff(authCtx: AuthContext): Promise<MyIdCardDto> {
    await getActiveUserRoleKeys(authCtx);
    return this.mine(authCtx.schoolId, { userId: authCtx.userId });
  }

  async mineAsStudent(schoolId: string, studentId: string): Promise<MyIdCardDto> {
    return this.mine(schoolId, { studentId });
  }

  private async mine(schoolId: string, who: { userId: string } | { studentId: string }): Promise<MyIdCardDto> {
    return withTenant(schoolId, async (db) => {
      const card = await db.idCard.findFirst({
        where: { ...who, status: "ACTIVE" },
        orderBy: { issuedAt: "desc" },
        select: CARD_SELECT,
      });
      const school = await this.schoolFor(schoolId);
      if (!card) return { school, card: null };
      const [printable] = await this.printable(db, schoolId, [card]);
      return { school, card: printable ?? null };
    });
  }

  // ------------------------------------------------------- the public check

  async verify(token: string): Promise<IdCardVerificationDto> {
    const read = readIdCardToken(token);
    if (!read) throw new NotFoundError("This code is not a School Kit ID card.");
    const school = await basePrisma.school.findUnique({ where: { slug: read.slug }, select: { id: true, name: true } });
    if (!school) throw new NotFoundError("This code is not a School Kit ID card.");
    return withTenant(school.id, async (db) => {
      const card = await db.idCard.findUnique({ where: { id: read.cardId }, select: CARD_SELECT });
      if (!card) throw new NotFoundError("This code is not a School Kit ID card.");
      const [p] = await this.printable(db, school.id, [card], PUBLIC_PHOTO_TTL_SECONDS);
      return {
        verdict: verdictFor(card.status, p!.validUntil, lagosToday()),
        schoolName: school.name,
        kind: p!.kind,
        name: p!.name,
        detail: p!.detail,
        cardNumber: p!.cardNumber,
        validFor: p!.validFor,
        photoUrl: p!.photoUrl,
      };
    });
  }

  // --------------------------------------------------------------- helpers

  private async schoolFor(schoolId: string): Promise<IdCardSchoolDto> {
    const s = await basePrisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { name: true, motto: true, address: true, phone: true, primaryColor: true, logoUrl: true },
    });
    return {
      name: s.name,
      motto: s.motto,
      address: s.address,
      phone: s.phone,
      primaryColor: s.primaryColor,
      logoUrl: await signSchoolLogoUrl(this.storage, schoolId, s.logoUrl),
    };
  }

  private async printable(
    db: PrismaClient,
    schoolId: string,
    cards: CardRow[],
    photoTtl: number = PHOTO_TTL_SECONDS,
  ): Promise<PrintableIdCardDto[]> {
    const slug = (await basePrisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { slug: true } })).slug;
    const years = new Map(
      (
        await db.academicYear.findMany({
          where: { id: { in: [...new Set(cards.map((c) => c.academicYearId))] } },
          select: { id: true, label: true, endDate: true },
        })
      ).map((y) => [y.id, y]),
    );
    const studentIds = cards.flatMap((c) => (c.studentId ? [c.studentId] : []));
    const userIds = cards.flatMap((c) => (c.userId ? [c.userId] : []));
    const students = new Map(
      (
        await db.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true, photoUploadedAt: true },
        })
      ).map((s) => [s.id, s]),
    );
    const classes = new Map(
      (
        await db.enrollment.findMany({
          where: { studentId: { in: studentIds }, term: { isCurrent: true } },
          select: { studentId: true, classArm: { select: { name: true } } },
        })
      ).map((e) => [e.studentId, e.classArm.name]),
    );
    const users = new Map(
      (
        await db.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            photoUploadedAt: true,
            teacherProfile: { select: { staffNumber: true } },
            roles: { select: { role: { select: { name: true } } } },
          },
        })
      ).map((u) => [u.id, u]),
    );

    const out: PrintableIdCardDto[] = [];
    for (const c of cards) {
      const year = years.get(c.academicYearId)!;
      const base = {
        id: c.id,
        kind: c.holderKind,
        cardNumber: c.cardNumber,
        status: c.status,
        validFor: year.label,
        validUntil: isoDate(year.endDate),
        verifyUrl: `${portalBaseUrl()}/id/${idCardToken(slug, c.id)}`,
      };
      if (c.studentId) {
        const s = students.get(c.studentId)!;
        out.push({
          ...base,
          name: fullName(s.firstName, s.middleName, s.lastName),
          number: s.admissionNumber,
          detail: classes.get(s.id) ?? null,
          photoUrl: s.photoUploadedAt
            ? await this.storage.signUrl(schoolId, { kind: "student-photo", studentId: s.id }, photoTtl)
            : null,
        });
      } else {
        const u = users.get(c.userId!)!;
        out.push({
          ...base,
          name: fullName(u.firstName, null, u.lastName),
          number: u.teacherProfile?.staffNumber ?? null,
          detail: u.roles.map((r) => r.role.name).join(", ") || null,
          photoUrl: u.photoUploadedAt
            ? await this.storage.signUrl(schoolId, { kind: "staff-photo", userId: u.id }, photoTtl)
            : null,
        });
      }
    }
    return out;
  }

  private async audit(
    db: PrismaClient,
    authCtx: AuthContext,
    action: string,
    cardId: string,
    reqCtx: RequestContext,
    metadata: Record<string, string>,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        action,
        entityType: "id_card",
        entityId: cardId,
        ipAddress: reqCtx.ipAddress,
        metadata,
      },
    });
  }
}
