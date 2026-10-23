import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  NotFoundError,
  ValidationError,
  type CalendarEntryDto,
  type EventRsvpSettingsInput,
  type RsvpCountsDto,
  type CalendarResponse,
  type CalendarWindowQuery,
  type CreateSchoolEventInput,
  type ManagedNationalEventDto,
  type SchoolEventDto,
  type UpdateSchoolEventInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { familyRsvps, rsvpCounts, RSVP_EVENT_SELECT, type RsvpEventRow } from "./event-rsvp.service.js";

// Phase 8 / CP1 — Event Calendar. Plan-first: docs/modules/phase-8.md §15.
//
// THE ONE READ (D27). buildCalendar() is the only code that turns the three
// calendar sources into what a person sees. Staff, guardians and students all
// call it; none of their controllers query school_events, national_events or
// school_hidden_national_events directly. Same instinct as Phase 6 D28's single
// released-results reader: two readers that "filter the same way today" stop
// doing so the first time one of them is edited.
//
// NATIONAL EVENTS ARE NEVER WRITTEN HERE. national_events is read-only to the
// runtime role in the database itself (D22: SELECT-only RLS policy + REVOKE).
// There is no create/update/delete for it in this service, and there could not
// be a working one. The school-side "hide" writes only the tenant-scoped
// school_hidden_national_events table.
//
// Phase 9 / CP10.1 (phase-9.md §19.2): an event may ask families to reply.
// The settings ride on create/update; the counts come back on the management
// list; a guardian's calendar read carries that family's own answer.

interface RequestContext {
  ipAddress: string | null;
}

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

// Management is owner/admin only (D28). Kept as one constant so the service-side
// role assertion and the seeded grants of calendar-event.create/update/delete and
// national-event.hide cannot drift — rbac-two-gate-conformance.spec.ts checks
// they agree.
const CALENDAR_MANAGER_ROLES = ["owner", "admin"] as const;

const AUDIT = {
  create: "calendar-event.create",
  update: "calendar-event.update",
  delete: "calendar-event.delete",
  hide: "national-event.hide",
  unhide: "national-event.unhide",
} as const;

const SCHOOL_EVENT_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  startDate: true,
  endDate: true,
  createdAt: true,
  updatedAt: true,
  rsvpOpen: true,
  rsvpDeadline: true,
  rsvpAskCount: true,
  rsvpClassArmIds: true,
  showOnWebsite: true,
} as const;

type SchoolEventRow = {
  id: string;
  title: string;
  description: string | null;
  category: SchoolEventDto["category"];
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  updatedAt: Date;
  showOnWebsite: boolean;
} & RsvpEventRow;

/** A @db.Date value as YYYY-MM-DD. Prisma returns DATE columns at UTC midnight. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → the Date Prisma expects for a @db.Date column (UTC midnight). */
function dateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function toSchoolEventDto(row: SchoolEventRow, counts?: RsvpCountsDto): SchoolEventDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    startDate: isoDate(row.startDate),
    endDate: isoDate(row.endDate),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rsvp: row.rsvpOpen
      ? {
          deadline: row.rsvpDeadline ? isoDate(row.rsvpDeadline) : null,
          askCount: row.rsvpAskCount,
          classArmIds: row.rsvpClassArmIds,
          counts: counts ?? { asked: 0, yes: 0, no: 0, maybe: 0, notAnswered: 0, attending: 0, maybeAttending: 0 },
        }
      : null,
    showOnWebsite: row.showOnWebsite,
  };
}

/** The columns an RSVP setting writes; null switches replies off (answers are kept). */
async function rsvpData(db: TenantDb, schoolId: string, rsvp: EventRsvpSettingsInput | undefined) {
  if (rsvp === undefined) return {};
  if (rsvp === null) return { rsvpOpen: false };
  const arms = [...new Set(rsvp.classArmIds)];
  if (arms.length) {
    const found = await db.classArm.count({ where: { schoolId, id: { in: arms } } });
    if (found !== arms.length) throw new ValidationError("Choose classes from this school.");
  }
  return {
    rsvpOpen: true,
    rsvpDeadline: rsvp.deadline ? dateOnly(rsvp.deadline) : null,
    rsvpAskCount: rsvp.askCount,
    rsvpClassArmIds: arms,
  };
}

// Sort order within a day: national holidays first (they frame the day), then
// term boundaries, then the school's own events. Stable on title after that, so
// the list never reshuffles between reloads.
const SOURCE_ORDER: Record<CalendarEntryDto["source"], number> = { NATIONAL: 0, TERM: 1, SCHOOL: 2 };

function compareEntries(a: CalendarEntryDto, b: CalendarEntryDto): number {
  return (
    a.startDate.localeCompare(b.startDate) ||
    SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

@Injectable()
export class CalendarService {
  // =========================================================================
  // THE merged read — every principal comes through here (D27).
  //
  // Takes the tenant db handle rather than opening its own transaction so a
  // caller that already holds one (none today) can reuse it, and so the spec
  // can exercise it against a real database under a real GUC.
  //
  // An entry is included when it OVERLAPS the window, not only when it starts
  // inside it: a mid-term break that began last week is still happening.
  // =========================================================================
  async buildCalendar(db: TenantDb, schoolId: string, window: CalendarWindowQuery): Promise<CalendarEntryDto[]> {
    const from = dateOnly(window.from);
    const to = dateOnly(window.to);

    const [schoolEvents, nationalEvents, terms] = await Promise.all([
      db.schoolEvent.findMany({
        // schoolId is ALSO in the WHERE clause, on top of RLS. Belt and braces,
        // the same as the curriculum similarity search.
        where: { schoolId, startDate: { lte: to }, endDate: { gte: from } },
        select: SCHOOL_EVENT_SELECT,
      }),
      db.nationalEvent.findMany({
        where: {
          startDate: { lte: to },
          endDate: { gte: from },
          // D19/D26 — a national event this school has hidden is omitted from
          // every read view. The relation filter reads the tenant-scoped hides
          // table, which RLS already limits to this school; schoolId is stated
          // anyway so the intent survives a policy change.
          hiddenBySchools: { none: { schoolId } },
        },
        select: { id: true, name: true, kind: true, startDate: true, endDate: true, dateConfirmed: true },
      }),
      // Term boundaries are DERIVED from Term rows at read time, never stored as
      // events, so they cannot drift from the terms an admin edits (D27).
      db.term.findMany({
        where: {
          schoolId,
          OR: [
            { startDate: { gte: from, lte: to } },
            { endDate: { gte: from, lte: to } },
          ],
        },
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          academicYear: { select: { label: true } },
        },
      }),
    ]);

    const entries: CalendarEntryDto[] = [];

    for (const e of nationalEvents) {
      entries.push({
        id: `national:${e.id}`,
        source: "NATIONAL",
        title: e.name,
        category: e.kind,
        startDate: isoDate(e.startDate),
        endDate: isoDate(e.endDate),
        dateConfirmed: e.dateConfirmed,
        description: null,
      });
    }

    for (const t of terms) {
      const label = `${t.name} (${t.academicYear.label})`;
      if (t.startDate >= from && t.startDate <= to) {
        const d = isoDate(t.startDate);
        entries.push({
          id: `term-start:${t.id}`,
          source: "TERM",
          title: `${label} begins`,
          category: "TERM_START",
          startDate: d,
          endDate: d,
          dateConfirmed: true,
          description: null,
        });
      }
      if (t.endDate >= from && t.endDate <= to) {
        const d = isoDate(t.endDate);
        entries.push({
          id: `term-end:${t.id}`,
          source: "TERM",
          title: `${label} ends`,
          category: "TERM_END",
          startDate: d,
          endDate: d,
          dateConfirmed: true,
          description: null,
        });
      }
    }

    for (const e of schoolEvents) {
      entries.push({
        id: `school:${e.id}`,
        source: "SCHOOL",
        title: e.title,
        category: e.category,
        startDate: isoDate(e.startDate),
        endDate: isoDate(e.endDate),
        dateConfirmed: true,
        description: e.description,
      });
    }

    return entries.sort(compareEntries);
  }

  /** Staff read (owner, admin, teacher, bursar). The permission guard re-checks isActive. */
  async getStaffCalendar(authCtx: AuthContext, window: CalendarWindowQuery): Promise<CalendarResponse> {
    return this.respond(authCtx.schoolId, window);
  }

  /** Guardian read — the school comes from the guardian's session, never from the request. */
  async getGuardianCalendar(schoolId: string, window: CalendarWindowQuery, guardianId?: string): Promise<CalendarResponse> {
    if (!guardianId) return this.respond(schoolId, window);
    const entries = await withTenant(schoolId, async (db) => {
      const list = await this.buildCalendar(db, schoolId, window);
      const ids = list.filter((e) => e.source === "SCHOOL").map((e) => e.id.slice("school:".length));
      const events = ids.length ? await db.schoolEvent.findMany({ where: { schoolId, id: { in: ids }, rsvpOpen: true }, select: RSVP_EVENT_SELECT }) : [];
      const mine = await familyRsvps(db, schoolId, guardianId, events);
      return list.map((e) => (e.source === "SCHOOL" && mine.has(e.id.slice("school:".length)) ? { ...e, rsvp: mine.get(e.id.slice("school:".length))! } : e));
    });
    return { from: window.from, to: window.to, entries };
  }

  /** Student read — the school comes from the student's session, never from the request. */
  async getStudentCalendar(schoolId: string, window: CalendarWindowQuery): Promise<CalendarResponse> {
    return this.respond(schoolId, window);
  }

  private async respond(schoolId: string, window: CalendarWindowQuery): Promise<CalendarResponse> {
    const entries = await withTenant(schoolId, (db) => this.buildCalendar(db, schoolId, window));
    return { from: window.from, to: window.to, entries };
  }

  // =========================================================================
  // Management — owner/admin (D28).
  // =========================================================================

  async listSchoolEvents(authCtx: AuthContext, window: CalendarWindowQuery): Promise<SchoolEventDto[]> {
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.schoolEvent.findMany({
        where: {
          schoolId: authCtx.schoolId,
          startDate: { lte: dateOnly(window.to) },
          endDate: { gte: dateOnly(window.from) },
        },
        select: SCHOOL_EVENT_SELECT,
        orderBy: [{ startDate: "asc" }, { title: "asc" }],
      });
      const counts = await rsvpCounts(db, authCtx.schoolId, rows);
      return rows.map((r) => toSchoolEventDto(r, counts.get(r.id)));
    });
  }

  async createSchoolEvent(
    authCtx: AuthContext,
    input: CreateSchoolEventInput,
    reqCtx: RequestContext,
  ): Promise<SchoolEventDto> {
    await assertUserActiveAndHasOneOf(authCtx, CALENDAR_MANAGER_ROLES);

    return withTenant(authCtx.schoolId, async (db) => {
      const created = await db.schoolEvent.create({
        data: {
          schoolId: authCtx.schoolId,
          title: input.title,
          description: input.description ?? null,
          category: input.category,
          startDate: dateOnly(input.startDate),
          endDate: dateOnly(input.endDate),
          createdBy: authCtx.userId,
          updatedBy: authCtx.userId,
          showOnWebsite: input.showOnWebsite ?? false,
          ...(await rsvpData(db, authCtx.schoolId, input.rsvp)),
        },
        select: SCHOOL_EVENT_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "school_event",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            title: created.title,
            category: created.category,
            startDate: input.startDate,
            endDate: input.endDate,
            rsvp: input.rsvp ? { deadline: input.rsvp.deadline, askCount: input.rsvp.askCount, classes: input.rsvp.classArmIds.length } : null,
            showOnWebsite: input.showOnWebsite ?? false,
          },
        },
      });

      return toSchoolEventDto(created, (await rsvpCounts(db, authCtx.schoolId, [created])).get(created.id));
    });
  }

  async updateSchoolEvent(
    authCtx: AuthContext,
    id: string,
    input: UpdateSchoolEventInput,
    reqCtx: RequestContext,
  ): Promise<SchoolEventDto> {
    await assertUserActiveAndHasOneOf(authCtx, CALENDAR_MANAGER_ROLES);

    return withTenant(authCtx.schoolId, async (db) => {
      // findFirst on (id, schoolId): an event id from another school is a 404,
      // exactly like one that does not exist (CLAUDE.md — re-validate tenancy on
      // every id in the path). RLS would hide it too; this does not rely on it.
      const existing = await db.schoolEvent.findFirst({
        where: { id, schoolId: authCtx.schoolId },
        select: SCHOOL_EVENT_SELECT,
      });
      if (!existing) throw new NotFoundError("Event not found.");

      // The reply-by date may never fall after the start date, whichever of
      // the two this update changes.
      const start = input.startDate ?? isoDate(existing.startDate);
      const deadline = input.rsvp !== undefined ? (input.rsvp?.deadline ?? null) : existing.rsvpDeadline ? isoDate(existing.rsvpDeadline) : null;
      if (deadline && deadline > start) throw new ValidationError("Reply-by must be on or before the start date.");

      const updated = await db.schoolEvent.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.startDate !== undefined ? { startDate: dateOnly(input.startDate) } : {}),
          ...(input.endDate !== undefined ? { endDate: dateOnly(input.endDate) } : {}),
          ...(input.showOnWebsite !== undefined ? { showOnWebsite: input.showOnWebsite } : {}),
          ...(await rsvpData(db, authCtx.schoolId, input.rsvp)),
          updatedBy: authCtx.userId,
        },
        select: SCHOOL_EVENT_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "school_event",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            before: {
              title: existing.title,
              category: existing.category,
              startDate: isoDate(existing.startDate),
              endDate: isoDate(existing.endDate),
            },
            changed: input,
          },
        },
      });

      return toSchoolEventDto(updated, (await rsvpCounts(db, authCtx.schoolId, [updated])).get(updated.id));
    });
  }

  async deleteSchoolEvent(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, CALENDAR_MANAGER_ROLES);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.schoolEvent.findFirst({
        where: { id, schoolId: authCtx.schoolId },
        select: SCHOOL_EVENT_SELECT,
      });
      if (!existing) throw new NotFoundError("Event not found.");

      await db.schoolEvent.delete({ where: { id } });

      // No event history table: the audit row carries enough to explain a
      // deletion afterwards (D25).
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "school_event",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            title: existing.title,
            category: existing.category,
            startDate: isoDate(existing.startDate),
            endDate: isoDate(existing.endDate),
          },
        },
      });
    });
  }

  /** National events in the window, with this school's hide state — hidden ones INCLUDED, so they can be unhidden (D26). */
  async listNationalEvents(authCtx: AuthContext, window: CalendarWindowQuery): Promise<ManagedNationalEventDto[]> {
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.nationalEvent.findMany({
        where: { startDate: { lte: dateOnly(window.to) }, endDate: { gte: dateOnly(window.from) } },
        select: {
          id: true,
          name: true,
          kind: true,
          startDate: true,
          endDate: true,
          dateConfirmed: true,
          hiddenBySchools: { where: { schoolId: authCtx.schoolId }, select: { id: true } },
        },
        orderBy: [{ startDate: "asc" }, { name: "asc" }],
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        startDate: isoDate(r.startDate),
        endDate: isoDate(r.endDate),
        dateConfirmed: r.dateConfirmed,
        hidden: r.hiddenBySchools.length > 0,
      }));
    });
  }

  /**
   * Hide a national event from this school's calendar (D19). Idempotent: hiding
   * an already-hidden event changes nothing and writes no audit row, so the
   * audit trail records real changes only.
   */
  async hideNationalEvent(authCtx: AuthContext, nationalEventId: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, CALENDAR_MANAGER_ROLES);

    await withTenant(authCtx.schoolId, async (db) => {
      const event = await this.requireNationalEvent(db, nationalEventId);

      const already = await db.schoolHiddenNationalEvent.findUnique({
        where: { schoolId_nationalEventId: { schoolId: authCtx.schoolId, nationalEventId } },
        select: { id: true },
      });
      if (already) return;

      await db.schoolHiddenNationalEvent.create({
        data: { schoolId: authCtx.schoolId, nationalEventId, hiddenBy: authCtx.userId },
      });

      // Tenant-scoped audit row: the school is known, so this is NOT one of the
      // NULL-school platform rows every tenant can read (§15.1).
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.hide,
          entityType: "national_event",
          entityId: nationalEventId,
          ipAddress: reqCtx.ipAddress,
          metadata: { key: event.key, name: event.name },
        },
      });
    });
  }

  /** Unhide — idempotent, audited only when a hide actually existed. */
  async unhideNationalEvent(authCtx: AuthContext, nationalEventId: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, CALENDAR_MANAGER_ROLES);

    await withTenant(authCtx.schoolId, async (db) => {
      const event = await this.requireNationalEvent(db, nationalEventId);

      const removed = await db.schoolHiddenNationalEvent.deleteMany({
        where: { schoolId: authCtx.schoolId, nationalEventId },
      });
      if (removed.count === 0) return;

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.unhide,
          entityType: "national_event",
          entityId: nationalEventId,
          ipAddress: reqCtx.ipAddress,
          metadata: { key: event.key, name: event.name },
        },
      });
    });
  }

  private async requireNationalEvent(db: TenantDb, id: string): Promise<{ key: string; name: string }> {
    const event = await db.nationalEvent.findUnique({ where: { id }, select: { key: true, name: true } });
    if (!event) throw new NotFoundError("National event not found.");
    return event;
  }
}
