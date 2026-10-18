import type { Prisma, PrismaClient } from "@school-kit/db";
import { messageRecipientLabel, sickbayDayOf, type MessageRecipient } from "@school-kit/types";

// Phase 9 / CP8.1 — who a conversation belongs to (docs/modules/phase-9.md
// §17.8). The rule the owner set: ONLY the recipient a parent chose, anyone
// it is passed to, and anyone who has written in it see a conversation. No
// other member of staff, including other admins.
//
// A recipient is a GROUP resolved from roles at the time of reading:
//   CLASS_TEACHER  one person, fixed on the thread (recipient_user_id);
//   BURSAR         holders of the bursar role;
//   PRINCIPAL      the appointed principal(s);
//   HEAD_TEACHER   the appointed head teacher(s);
//   ADMIN          the owner and admins;
//   OFFICE         the Inbox officers, or the owner and admins when the school
//                  has appointed none.

type Db = PrismaClient;

/** Every role that can be written to; the service narrows each to its own conversations. */
export const MESSAGE_ROLE_KEYS = ["owner", "admin", "teacher", "bursar", "principal", "head_teacher", "inbox_officer"] as const;

export interface StaffMessagingIdentity {
  userId: string;
  /** The groups this person answers for, other than CLASS_TEACHER (which is per thread). */
  groups: Set<MessageRecipient>;
}

const ADMIN_KEYS = ["owner", "admin"];

/** Whether the school has appointed any Inbox officer. */
export async function hasInboxOfficers(db: Db, schoolId: string): Promise<boolean> {
  const n = await db.user.count({ where: { schoolId, isActive: true, roles: { some: { role: { key: "inbox_officer" } } } } });
  return n > 0;
}

export async function messagingIdentity(db: Db, schoolId: string, userId: string): Promise<StaffMessagingIdentity> {
  const user = await db.user.findFirst({
    where: { id: userId, schoolId },
    select: { roles: { select: { role: { select: { key: true } } } } },
  });
  const keys = new Set((user?.roles ?? []).map((r) => r.role.key));
  const groups = new Set<MessageRecipient>();
  const isAdmin = ADMIN_KEYS.some((k) => keys.has(k));
  if (keys.has("bursar")) groups.add("BURSAR");
  if (keys.has("principal")) groups.add("PRINCIPAL");
  if (keys.has("head_teacher")) groups.add("HEAD_TEACHER");
  if (isAdmin) groups.add("ADMIN");
  if (keys.has("inbox_officer") || (isAdmin && !(await hasInboxOfficers(db, schoolId)))) groups.add("OFFICE");
  return { userId, groups };
}

/** The conversations this member of staff may see. */
export function visibleTo(me: StaffMessagingIdentity, schoolId: string): Prisma.MessageThreadWhereInput {
  const groups = [...me.groups];
  return {
    schoolId,
    OR: [
      { recipient: { in: groups } },
      { recipient: "CLASS_TEACHER", recipientUserId: me.userId },
      { passes: { some: { OR: [{ recipient: { in: groups } }, { recipient: "CLASS_TEACHER", recipientUserId: me.userId }, { passedByUserId: me.userId }] } } },
      { messages: { some: { userId: me.userId } } },
    ],
  };
}

/** The user ids who may see a conversation now: whom to tell of a parent's message. */
export async function recipientsOf(
  db: Db,
  schoolId: string,
  thread: { recipient: MessageRecipient; recipientUserId: string | null; passes: { recipient: MessageRecipient; recipientUserId: string | null; passedByUserId: string }[] },
): Promise<string[]> {
  const ids = new Set<string>();
  const targets = [{ recipient: thread.recipient, recipientUserId: thread.recipientUserId }, ...thread.passes];
  const officers = await hasInboxOfficers(db, schoolId);
  for (const t of targets) {
    if (t.recipient === "CLASS_TEACHER") {
      if (t.recipientUserId) ids.add(t.recipientUserId);
      continue;
    }
    for (const id of await holdersOf(db, schoolId, t.recipient, officers)) ids.add(id);
  }
  for (const p of thread.passes) ids.add(p.passedByUserId);
  const active = await db.user.findMany({ where: { schoolId, isActive: true, id: { in: [...ids] } }, select: { id: true } });
  return active.map((u) => u.id);
}

/** Active holders of a group recipient. */
export async function holdersOf(db: Db, schoolId: string, recipient: Exclude<MessageRecipient, "CLASS_TEACHER">, officers?: boolean): Promise<string[]> {
  const keys: string[] =
    recipient === "BURSAR"
      ? ["bursar"]
      : recipient === "PRINCIPAL"
        ? ["principal"]
        : recipient === "HEAD_TEACHER"
          ? ["head_teacher"]
          : recipient === "ADMIN"
            ? ADMIN_KEYS
            : (officers ?? (await hasInboxOfficers(db, schoolId)))
              ? ["inbox_officer"]
              : ADMIN_KEYS;
  const users = await db.user.findMany({
    where: { schoolId, isActive: true, roles: { some: { role: { key: { in: keys } } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** The child's class arm this term, its class teacher, and whether it is secondary (JSS, SSS). */
export async function childPlacement(db: Db, schoolId: string, studentId: string) {
  const enrollment = await db.enrollment.findFirst({
    where: { schoolId, studentId, term: { isCurrent: true } },
    select: {
      classArm: {
        select: {
          name: true,
          classTeacherId: true,
          classTeacher: { select: { id: true, firstName: true, lastName: true, isActive: true } },
          classLevel: { select: { stage: true } },
        },
      },
    },
  });
  const arm = enrollment?.classArm;
  return {
    armName: arm?.name ?? null,
    secondary: arm ? arm.classLevel.stage === "JSS" || arm.classLevel.stage === "SSS" : null,
    classTeacher: arm?.classTeacher && arm.classTeacher.isActive ? { id: arm.classTeacher.id, name: `${arm.classTeacher.firstName} ${arm.classTeacher.lastName}`.trim() } : null,
  };
}

/** How a staff message is signed to the family: "Mrs Okafor, Form teacher", or "<School> office". */
export function staffAuthorLabel(asRecipient: MessageRecipient, writer: { firstName: string; lastName: string } | null, opts: { secondary: boolean; schoolName: string }): string {
  if (asRecipient === "OFFICE") return messageRecipientLabel("OFFICE", { schoolName: opts.schoolName });
  const role = messageRecipientLabel(asRecipient, { secondary: opts.secondary });
  const name = writer ? `${writer.firstName} ${writer.lastName}`.trim() : "";
  return name ? `${name}, ${role}` : role;
}

/** The start of today in Lagos, as a moment. Lagos is UTC+1. */
export function lagosDayStart(now = new Date()): Date {
  return new Date(`${sickbayDayOf(now)}T00:00:00+01:00`);
}

/** The Lagos calendar day, as a DATE. */
export function lagosToday(): Date {
  return new Date(`${sickbayDayOf(new Date())}T00:00:00.000Z`);
}

/** Open conversations this member of staff may see whose last message is a parent's, unread by them. */
export async function unreadMessagesFor(db: Db, schoolId: string, userId: string): Promise<number> {
  const me = await messagingIdentity(db, schoolId, userId);
  const rows = await db.messageThread.findMany({
    where: { AND: [visibleTo(me, schoolId), { status: "OPEN", lastMessageBy: "GUARDIAN" }] },
    select: { lastMessageAt: true, reads: { where: { readerKind: "STAFF", readerId: userId }, select: { lastReadAt: true } } },
    take: 500,
  });
  return rows.filter((r) => !r.reads[0] || r.reads[0].lastReadAt < r.lastMessageAt).length;
}
