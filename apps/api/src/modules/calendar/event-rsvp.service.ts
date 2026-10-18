import { Injectable, Logger, Optional } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  sickbayDayOf,
  type AnswerRsvpInput,
  type EventRsvpListDto,
  type EventRsvpRowDto,
  type FamilyRsvpDto,
  type RsvpAnswer,
  type RsvpCountsDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { NotificationDispatchService } from "../notifications/notification-dispatch.service.js";

// Phase 9 / CP10.1 — event RSVPs (docs/modules/phase-9.md §19.2).
//
// WHO IS ASKED: every parent linked to a child enrolled this term, in the
// chosen classes when there are any, less a parent whose portal access the
// school switched off. One answer per parent, changeable until the reply-by
// date, or the event's start date when there is none (Lagos calendar days).
//
// A parent sees only their own answer. The school (owner, admin) sees the
// counts and the list. The one reminder is a push the day before the reply-by
// date to parents who have not answered, in lockscreen-safe words (N3).

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

const CALENDAR_MANAGER_ROLES = ["owner", "admin"] as const;
export const RSVP_REMINDER_EVENT = "event.rsvp-reminder";

export interface RsvpEventRow {
  id: string;
  title: string;
  startDate: Date;
  rsvpOpen: boolean;
  rsvpDeadline: Date | null;
  rsvpAskCount: boolean;
  rsvpClassArmIds: string[];
}

export const RSVP_EVENT_SELECT = {
  id: true,
  title: true,
  startDate: true,
  rsvpOpen: true,
  rsvpDeadline: true,
  rsvpAskCount: true,
  rsvpClassArmIds: true,
} as const;

interface AskedParent {
  guardianId: string;
  name: string;
  phone: string;
  children: { name: string; className: string | null }[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The last Lagos day replies are taken: the reply-by date, else the start date. */
export function rsvpLastDay(e: { startDate: Date; rsvpDeadline: Date | null }): string {
  return isoDate(e.rsvpDeadline ?? e.startDate);
}

export function rsvpAccepting(e: RsvpEventRow, today = sickbayDayOf(new Date())): boolean {
  return e.rsvpOpen && today <= rsvpLastDay(e);
}

/** The parents an event asks, with their children in the asked classes. */
export async function askedParents(db: TenantDb, schoolId: string, e: Pick<RsvpEventRow, "rsvpClassArmIds">): Promise<AskedParent[]> {
  const enrollments = await db.enrollment.findMany({
    where: { schoolId, term: { isCurrent: true }, ...(e.rsvpClassArmIds.length ? { classArmId: { in: e.rsvpClassArmIds } } : {}) },
    select: { studentId: true, classArm: { select: { name: true } }, student: { select: { firstName: true, lastName: true } } },
  });
  const childOf = new Map(enrollments.map((x) => [x.studentId, { name: `${x.student.firstName} ${x.student.lastName}`.trim(), className: x.classArm?.name ?? null }]));
  if (childOf.size === 0) return [];
  const links = await db.studentGuardian.findMany({
    where: { studentId: { in: [...childOf.keys()] }, guardian: { schoolId, portalDisabledAt: null } },
    select: { studentId: true, guardian: { select: { id: true, firstName: true, lastName: true, phone: true } } },
  });
  const out = new Map<string, AskedParent>();
  for (const l of links) {
    const p = out.get(l.guardian.id) ?? { guardianId: l.guardian.id, name: `${l.guardian.firstName} ${l.guardian.lastName}`.trim(), phone: l.guardian.phone, children: [] };
    p.children.push(childOf.get(l.studentId)!);
    out.set(l.guardian.id, p);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Counts for these events, each against the parents it asks. */
export async function rsvpCounts(db: TenantDb, schoolId: string, events: RsvpEventRow[]): Promise<Map<string, RsvpCountsDto>> {
  const out = new Map<string, RsvpCountsDto>();
  for (const e of events.filter((x) => x.rsvpOpen)) {
    const asked = await askedParents(db, schoolId, e);
    const askedIds = new Set(asked.map((p) => p.guardianId));
    const answers = (await db.eventRsvp.findMany({ where: { schoolId, eventId: e.id }, select: { guardianId: true, answer: true, attending: true } })).filter((a) =>
      askedIds.has(a.guardianId),
    );
    out.set(e.id, tally(asked.length, answers));
  }
  return out;
}

function tally(asked: number, answers: { answer: string; attending: number | null }[]): RsvpCountsDto {
  const c: RsvpCountsDto = { asked, yes: 0, no: 0, maybe: 0, notAnswered: 0, attending: 0, maybeAttending: 0 };
  for (const a of answers) {
    if (a.answer === "YES") {
      c.yes += 1;
      c.attending += a.attending ?? 1;
    } else if (a.answer === "MAYBE") {
      c.maybe += 1;
      c.maybeAttending += a.attending ?? 1;
    } else c.no += 1;
  }
  c.notAnswered = Math.max(0, asked - c.yes - c.no - c.maybe);
  return c;
}

/** This parent's view of each event that asks them, for the family calendar. */
export async function familyRsvps(db: TenantDb, schoolId: string, guardianId: string, events: RsvpEventRow[]): Promise<Map<string, FamilyRsvpDto>> {
  const out = new Map<string, FamilyRsvpDto>();
  const open = events.filter((e) => e.rsvpOpen);
  if (open.length === 0) return out;
  const mine = new Map(
    (await db.eventRsvp.findMany({ where: { schoolId, guardianId, eventId: { in: open.map((e) => e.id) } }, select: { eventId: true, answer: true, attending: true } })).map(
      (r) => [r.eventId, r],
    ),
  );
  const today = sickbayDayOf(new Date());
  for (const e of open) {
    if (!(await isAsked(db, schoolId, guardianId, e))) continue;
    const r = mine.get(e.id);
    out.set(e.id, {
      deadline: e.rsvpDeadline ? isoDate(e.rsvpDeadline) : null,
      askCount: e.rsvpAskCount,
      open: rsvpAccepting(e, today),
      answer: (r?.answer as RsvpAnswer | undefined) ?? null,
      attending: r?.attending ?? null,
    });
  }
  return out;
}

async function isAsked(db: TenantDb, schoolId: string, guardianId: string, e: Pick<RsvpEventRow, "rsvpClassArmIds">): Promise<boolean> {
  const n = await db.studentGuardian.count({
    where: {
      guardianId,
      guardian: { schoolId, portalDisabledAt: null },
      student: { enrollments: { some: { schoolId, term: { isCurrent: true }, ...(e.rsvpClassArmIds.length ? { classArmId: { in: e.rsvpClassArmIds } } : {}) } } },
    },
  });
  return n > 0;
}

@Injectable()
export class EventRsvpService {
  private readonly logger = new Logger(EventRsvpService.name);

  constructor(@Optional() private readonly dispatch?: NotificationDispatchService) {}

  /** The school's view: counts and every asked parent, answered or not. */
  async list(authCtx: AuthContext, eventId: string): Promise<EventRsvpListDto> {
    await assertUserActiveAndHasOneOf(authCtx, CALENDAR_MANAGER_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const e = await db.schoolEvent.findFirst({ where: { id: eventId, schoolId: authCtx.schoolId }, select: RSVP_EVENT_SELECT });
      if (!e) throw new NotFoundError("Event not found.");
      if (!e.rsvpOpen) throw new ConflictError("RSVP_OFF", "This event does not ask families to reply.");
      const asked = await askedParents(db, authCtx.schoolId, e);
      const answers = new Map(
        (await db.eventRsvp.findMany({ where: { schoolId: authCtx.schoolId, eventId }, select: { guardianId: true, answer: true, attending: true, updatedAt: true } })).map((r) => [
          r.guardianId,
          r,
        ]),
      );
      const rows: EventRsvpRowDto[] = asked.map((p) => {
        const a = answers.get(p.guardianId);
        return {
          guardianId: p.guardianId,
          guardianName: p.name,
          phone: p.phone,
          children: p.children,
          answer: (a?.answer as RsvpAnswer | undefined) ?? null,
          attending: a?.attending ?? null,
          answeredAt: a ? a.updatedAt.toISOString() : null,
        };
      });
      return {
        event: { id: e.id, title: e.title, startDate: isoDate(e.startDate), deadline: e.rsvpDeadline ? isoDate(e.rsvpDeadline) : null, askCount: e.rsvpAskCount, open: rsvpAccepting(e) },
        counts: tally(
          asked.length,
          rows.filter((r) => r.answer).map((r) => ({ answer: r.answer!, attending: r.attending })),
        ),
        rows,
      };
    });
  }

  /** A parent's answer, or a change to it, while replies are taken. */
  async answer(g: GuardianAuthContext, eventId: string, input: AnswerRsvpInput, req: { ipAddress: string | null }): Promise<FamilyRsvpDto> {
    return withTenant(g.schoolId, async (db) => {
      const e = await db.schoolEvent.findFirst({ where: { id: eventId, schoolId: g.schoolId }, select: RSVP_EVENT_SELECT });
      if (!e || !e.rsvpOpen || !(await isAsked(db, g.schoolId, g.guardianId, e))) throw new NotFoundError("Event not found.");
      if (!rsvpAccepting(e)) throw new ConflictError("RSVP_CLOSED", "Replies for this event have closed.");
      const attending = e.rsvpAskCount && input.answer !== "NO" ? input.attending : null;
      await db.eventRsvp.upsert({
        where: { eventId_guardianId: { eventId, guardianId: g.guardianId } },
        create: { schoolId: g.schoolId, eventId, guardianId: g.guardianId, answer: input.answer, attending },
        update: { answer: input.answer, attending },
      });
      await db.auditLog.create({
        data: {
          schoolId: g.schoolId,
          userId: null,
          action: "event.rsvp",
          entityType: "school_event",
          entityId: eventId,
          ipAddress: req.ipAddress,
          metadata: { guardianId: g.guardianId, answer: input.answer, attending },
        },
      });
      return {
        deadline: e.rsvpDeadline ? isoDate(e.rsvpDeadline) : null,
        askCount: e.rsvpAskCount,
        open: true,
        answer: input.answer,
        attending,
      };
    });
  }

  @Cron("0 8 * * *", { timeZone: "Africa/Lagos" })
  async nightly(): Promise<void> {
    try {
      const n = await this.sendReminders(new Date());
      if (n > 0) this.logger.log(`Sent ${n} RSVP reminders.`);
    } catch (err) {
      this.logger.error(`RSVP reminders failed: ${String(err)}`);
    }
  }

  /**
   * One push, the day before the reply-by date, to asked parents with no
   * answer. Each event is reminded once. Returns how many pushes were asked for.
   */
  async sendReminders(now: Date): Promise<number> {
    const tomorrow = sickbayDayOf(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const schools = await basePrisma.school.findMany({ select: { id: true, name: true } });
    let sent = 0;
    for (const school of schools) {
      const due = await withTenant(school.id, async (db) => {
        const events = await db.schoolEvent.findMany({
          where: { schoolId: school.id, rsvpOpen: true, rsvpRemindedAt: null, rsvpDeadline: new Date(`${tomorrow}T00:00:00.000Z`) },
          select: RSVP_EVENT_SELECT,
        });
        const out: { eventId: string; guardianIds: string[] }[] = [];
        for (const e of events) {
          const claimed = await db.schoolEvent.updateMany({ where: { id: e.id, rsvpRemindedAt: null }, data: { rsvpRemindedAt: now } });
          if (claimed.count !== 1) continue;
          const asked = await askedParents(db, school.id, e);
          const answered = new Set((await db.eventRsvp.findMany({ where: { schoolId: school.id, eventId: e.id }, select: { guardianId: true } })).map((r) => r.guardianId));
          out.push({ eventId: e.id, guardianIds: asked.map((p) => p.guardianId).filter((id) => !answered.has(id)) });
        }
        return out;
      });
      for (const d of due) {
        for (const guardianId of d.guardianIds) {
          await this.dispatch?.notifyOfEvent({
            schoolId: school.id,
            principal: { type: "GUARDIAN", guardianId },
            eventType: RSVP_REMINDER_EVENT,
            eventId: d.eventId,
            title: school.name,
            // Lockscreen-safe (N3): what is asked, never the event's own words.
            body: "An event is waiting for your reply. Replies close tomorrow.",
            data: { screen: "calendar" },
          });
          sent += 1;
        }
      }
    }
    return sent;
  }
}
