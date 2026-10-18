import { Injectable } from "@nestjs/common";

import { withTenant, type Prisma, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  messageRecipientLabel,
  NotFoundError,
  ValidationError,
  type ListMessagesInput,
  type MarkHandledInput,
  type MessageGuardianOptionDto,
  type MessageRecipient,
  type MessageRecipientOptionDto,
  type OfficeStartMessageInput,
  type PassMessageInput,
  type ReplyMessageInput,
  type StaffMessageListDto,
  type StaffMessageThreadDto,
  type StaffMessageThreadSummaryDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { MessageAlertsService } from "./message-alerts.service.js";
import { childPlacement, holdersOf, messagingIdentity, staffAuthorLabel, visibleTo, type StaffMessagingIdentity } from "./messages.shared.js";

// Phase 9 / CP8.1 — the school's side of messaging (docs/modules/phase-9.md
// §17.8). Each member of staff sees ONLY the conversations addressed or
// passed to them, or that they have written in; nothing else, admins
// included. Within those they reply, pass a conversation to another
// recipient, mark it handled, and close it. The school office (admins and
// Inbox officers) may start a conversation with one parent.
//
// Nothing anyone typed reaches an audit row or a log line: audit rows carry
// ids and recipients only.

const MESSAGE_ROLES = ["owner", "admin", "teacher", "bursar", "principal", "head_teacher", "inbox_officer"] as const;
const OFFICE_START_ROLES = ["owner", "admin", "inbox_officer"] as const;

type Db = PrismaClient;

interface RequestContext {
  ipAddress: string | null;
}

const THREAD_SELECT = {
  id: true,
  subject: true,
  status: true,
  recipient: true,
  recipientUserId: true,
  lastMessageAt: true,
  lastMessageBy: true,
  closedAt: true,
  handledByUserId: true,
  guardian: { select: { id: true, firstName: true, lastName: true, phone: true, relationship: true } },
  student: { select: { id: true, firstName: true, lastName: true } },
  passes: { orderBy: { createdAt: "asc" }, select: { recipient: true, recipientUserId: true, passedByUserId: true, createdAt: true } },
} as const satisfies Prisma.MessageThreadSelect;

type ThreadRow = Prisma.MessageThreadGetPayload<{ select: typeof THREAD_SELECT }>;

@Injectable()
export class MessagesService {
  constructor(private readonly alerts: MessageAlertsService) {}

  async list(authCtx: AuthContext, query: ListMessagesInput): Promise<StaffMessageListDto> {
    await assertUserActiveAndHasOneOf(authCtx, MESSAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const me = await messagingIdentity(db, authCtx.schoolId, authCtx.userId);
      const visible = visibleTo(me, authCtx.schoolId);
      const rows = await db.messageThread.findMany({
        where: { AND: [visible, { status: query.box }] },
        orderBy: { lastMessageAt: "desc" },
        take: 200,
        select: { ...THREAD_SELECT, reads: { where: { readerKind: "STAFF", readerId: authCtx.userId }, select: { lastReadAt: true } } },
      });
      const names = await userNames(db, authCtx.schoolId, rows.flatMap((r) => [r.handledByUserId, r.recipientUserId, ...r.passes.map((p) => p.recipientUserId)]));
      const items = rows.map((r) => summary(r, names, isUnread(r, r.reads[0]?.lastReadAt)));
      const unread = await countUnread(db, authCtx.userId, visible);
      return { items, unread };
    });
  }

  /** One conversation. Opening it marks it read for this member of staff. */
  async get(authCtx: AuthContext, id: string): Promise<StaffMessageThreadDto> {
    await assertUserActiveAndHasOneOf(authCtx, MESSAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const me = await messagingIdentity(db, authCtx.schoolId, authCtx.userId);
      const thread = await loadVisible(db, me, authCtx.schoolId, id);
      await markRead(db, authCtx.schoolId, id, authCtx.userId);
      return this.detail(db, authCtx, me, thread);
    });
  }

  async reply(authCtx: AuthContext, id: string, input: ReplyMessageInput, req: RequestContext): Promise<StaffMessageThreadDto> {
    await assertUserActiveAndHasOneOf(authCtx, MESSAGE_ROLES);
    const messageId = await withTenant(authCtx.schoolId, async (db) => {
      const me = await messagingIdentity(db, authCtx.schoolId, authCtx.userId);
      const thread = await loadVisible(db, me, authCtx.schoolId, id);
      if (thread.status !== "OPEN") throw new ConflictError("MESSAGE_CLOSED", "This conversation is closed. The parent can start a new one.");
      const now = new Date();
      const message = await db.message.create({
        data: { schoolId: authCtx.schoolId, threadId: id, authorKind: "STAFF", userId: authCtx.userId, asRecipient: actingAs(me, thread), body: input.body },
        select: { id: true },
      });
      await db.messageThread.update({ where: { id }, data: { lastMessageAt: now, lastMessageBy: "STAFF" } });
      await markRead(db, authCtx.schoolId, id, authCtx.userId, now);
      await audit(db, authCtx, req, "message.reply", id, { messageId: message.id });
      return message.id;
    });
    await this.alerts.toGuardian(authCtx.schoolId, id, messageId);
    return this.get(authCtx, id);
  }

  /** Passes the conversation to another recipient, who then sees all of it. The one who passed keeps it. */
  async pass(authCtx: AuthContext, id: string, input: PassMessageInput, req: RequestContext): Promise<StaffMessageThreadDto> {
    await assertUserActiveAndHasOneOf(authCtx, MESSAGE_ROLES);
    await withTenant(authCtx.schoolId, async (db) => {
      const me = await messagingIdentity(db, authCtx.schoolId, authCtx.userId);
      const thread = await loadVisible(db, me, authCtx.schoolId, id);
      if (thread.status !== "OPEN") throw new ConflictError("MESSAGE_CLOSED", "This conversation is closed.");
      const option = (await passOptions(db, authCtx.schoolId, thread)).find((o) => o.recipient === input.recipient);
      if (!option) throw new ValidationError("This conversation cannot be passed to them.");
      const recipientUserId = input.recipient === "CLASS_TEACHER" ? option.userId : null;
      await db.messagePass.create({
        data: { schoolId: authCtx.schoolId, threadId: id, recipient: input.recipient, recipientUserId, passedByUserId: authCtx.userId },
      });
      await audit(db, authCtx, req, "message.pass", id, { recipient: input.recipient });
    });
    return this.get(authCtx, id);
  }

  /** "I'm handling this", so two people do not reply twice. */
  async markHandled(authCtx: AuthContext, id: string, input: MarkHandledInput, req: RequestContext): Promise<StaffMessageThreadDto> {
    await assertUserActiveAndHasOneOf(authCtx, MESSAGE_ROLES);
    await withTenant(authCtx.schoolId, async (db) => {
      const me = await messagingIdentity(db, authCtx.schoolId, authCtx.userId);
      await loadVisible(db, me, authCtx.schoolId, id);
      await db.messageThread.update({ where: { id }, data: { handledByUserId: input.handled ? authCtx.userId : null } });
      await audit(db, authCtx, req, input.handled ? "message.handled" : "message.unhandled", id, {});
    });
    return this.get(authCtx, id);
  }

  async close(authCtx: AuthContext, id: string, req: RequestContext): Promise<StaffMessageThreadDto> {
    await assertUserActiveAndHasOneOf(authCtx, MESSAGE_ROLES);
    await withTenant(authCtx.schoolId, async (db) => {
      const me = await messagingIdentity(db, authCtx.schoolId, authCtx.userId);
      await loadVisible(db, me, authCtx.schoolId, id);
      const done = await db.messageThread.updateMany({
        where: { id, schoolId: authCtx.schoolId, status: "OPEN" },
        data: { status: "CLOSED", closedAt: new Date(), closedByUserId: authCtx.userId },
      });
      if (done.count !== 1) throw new ConflictError("MESSAGE_CLOSED", "This conversation is already closed.");
      await audit(db, authCtx, req, "message.close", id, {});
    });
    return this.get(authCtx, id);
  }

  /** The school office starts a conversation with one parent (§17.8 answer 2). */
  async officeStart(authCtx: AuthContext, input: OfficeStartMessageInput, req: RequestContext): Promise<StaffMessageThreadDto> {
    await assertUserActiveAndHasOneOf(authCtx, OFFICE_START_ROLES);
    const created = await withTenant(authCtx.schoolId, async (db) => {
      const guardian = await db.guardian.findFirst({ where: { id: input.guardianId, schoolId: authCtx.schoolId }, select: { id: true } });
      if (!guardian) throw new NotFoundError("Parent not found.");
      if (input.studentId) {
        const link = await db.studentGuardian.findFirst({ where: { guardianId: guardian.id, studentId: input.studentId }, select: { id: true } });
        if (!link) throw new ValidationError("Choose one of this parent's children.");
      }
      const now = new Date();
      const thread = await db.messageThread.create({
        data: {
          schoolId: authCtx.schoolId,
          guardianId: guardian.id,
          studentId: input.studentId,
          recipient: "OFFICE",
          subject: input.subject,
          startedByUserId: authCtx.userId,
          lastMessageAt: now,
          lastMessageBy: "STAFF",
        },
        select: { id: true },
      });
      const message = await db.message.create({
        data: { schoolId: authCtx.schoolId, threadId: thread.id, authorKind: "STAFF", userId: authCtx.userId, asRecipient: "OFFICE", body: input.body },
        select: { id: true },
      });
      await markRead(db, authCtx.schoolId, thread.id, authCtx.userId, now);
      await audit(db, authCtx, req, "message.office-start", thread.id, { child: input.studentId !== null });
      return { threadId: thread.id, messageId: message.id };
    });
    await this.alerts.toGuardian(authCtx.schoolId, created.threadId, created.messageId);
    return this.get(authCtx, created.threadId);
  }

  /** Parents to write to, for the office: by name or phone, with their children. */
  async searchGuardians(authCtx: AuthContext, q: string): Promise<MessageGuardianOptionDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, OFFICE_START_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const words = q.split(/\s+/).filter(Boolean).slice(0, 3);
      const rows = await db.guardian.findMany({
        where: {
          schoolId: authCtx.schoolId,
          AND: words.map((w) => ({
            OR: [
              { firstName: { contains: w, mode: "insensitive" as const } },
              { lastName: { contains: w, mode: "insensitive" as const } },
              { phone: { contains: w } },
            ],
          })),
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: 20,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          students: { select: { student: { select: { id: true, firstName: true, lastName: true, status: true } } } },
        },
      });
      return rows.map((g) => ({
        id: g.id,
        name: `${g.firstName} ${g.lastName}`.trim(),
        phone: g.phone,
        children: g.students
          .filter((s) => s.student.status === "ACTIVE")
          .map((s) => ({ id: s.student.id, name: `${s.student.firstName} ${s.student.lastName}`.trim() })),
      }));
    });
  }

  private async detail(db: Db, authCtx: AuthContext, me: StaffMessagingIdentity, thread: ThreadRow): Promise<StaffMessageThreadDto> {
    const messages = await db.message.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, authorKind: true, userId: true, asRecipient: true, body: true, createdAt: true },
    });
    const school = await db.school.findUniqueOrThrow({ where: { id: authCtx.schoolId }, select: { name: true } });
    const placement = thread.student ? await childPlacement(db, authCtx.schoolId, thread.student.id) : null;
    const secondary = placement?.secondary ?? false;
    const names = await userNames(db, authCtx.schoolId, [
      thread.handledByUserId,
      thread.recipientUserId,
      ...thread.passes.flatMap((p) => [p.recipientUserId, p.passedByUserId]),
      ...messages.map((m) => m.userId),
    ]);
    const writers = await db.user.findMany({
      where: { schoolId: authCtx.schoolId, id: { in: messages.map((m) => m.userId).filter((v): v is string => !!v) } },
      select: { id: true, firstName: true, lastName: true },
    });
    const writer = new Map(writers.map((w) => [w.id, w]));
    const guardianName = `${thread.guardian.firstName} ${thread.guardian.lastName}`.trim();
    return {
      ...summary(thread, names, false),
      guardian: { id: thread.guardian.id, name: guardianName, phone: thread.guardian.phone, relationship: thread.guardian.relationship },
      child: thread.student ? { id: thread.student.id, name: `${thread.student.firstName} ${thread.student.lastName}`.trim(), className: placement?.armName ?? null } : null,
      messages: messages.map((m) =>
        m.authorKind === "GUARDIAN"
          ? { id: m.id, mine: false, author: guardianName, body: m.body, sentAt: m.createdAt, writtenBy: null }
          : {
              id: m.id,
              mine: m.userId === authCtx.userId,
              author: staffAuthorLabel(m.asRecipient!, writer.get(m.userId!) ?? null, { secondary, schoolName: school.name }),
              body: m.body,
              sentAt: m.createdAt,
              writtenBy: names.get(m.userId!) ?? null,
            },
      ),
      passes: thread.passes.map((p) => ({ to: target(p.recipient, p.recipientUserId, names), by: names.get(p.passedByUserId) ?? "A member of staff", at: p.createdAt })),
      closedAt: thread.closedAt,
      passOptions: thread.status === "OPEN" ? (await passOptions(db, authCtx.schoolId, thread)).map(({ userId: _u, ...o }) => o) : [],
      canClose: thread.status === "OPEN",
    };
  }
}

/** A conversation this member of staff may see, or not found. */
async function loadVisible(db: Db, me: StaffMessagingIdentity, schoolId: string, id: string): Promise<ThreadRow> {
  const thread = await db.messageThread.findFirst({ where: { AND: [visibleTo(me, schoolId), { id }] }, select: THREAD_SELECT });
  if (!thread) throw new NotFoundError("Conversation not found.");
  return thread;
}

/** Which recipient the writer answers as: the first of the conversation's recipients they belong to. */
function actingAs(me: StaffMessagingIdentity, thread: ThreadRow): MessageRecipient {
  const targets = [{ recipient: thread.recipient, recipientUserId: thread.recipientUserId }, ...thread.passes];
  for (const t of targets) {
    if (t.recipient === "CLASS_TEACHER" ? t.recipientUserId === me.userId : me.groups.has(t.recipient)) return t.recipient;
  }
  // Someone who passed it on, or wrote in it before, answering again.
  for (const g of ["PRINCIPAL", "HEAD_TEACHER", "BURSAR", "ADMIN", "OFFICE"] as const) if (me.groups.has(g)) return g;
  if (thread.recipient === "CLASS_TEACHER" || thread.passes.some((p) => p.recipientUserId === me.userId)) return "CLASS_TEACHER";
  throw new ForbiddenError("You cannot reply to this conversation.");
}

/** The recipients a conversation may be passed to: the four group recipients, and the child's class teacher. */
async function passOptions(db: Db, schoolId: string, thread: ThreadRow): Promise<(MessageRecipientOptionDto & { userId: string | null })[]> {
  const already = new Set([thread.recipient, ...thread.passes.map((p) => p.recipient)]);
  const out: (MessageRecipientOptionDto & { userId: string | null })[] = [];
  const placement = thread.student ? await childPlacement(db, schoolId, thread.student.id) : null;
  if (placement?.classTeacher && !already.has("CLASS_TEACHER")) {
    out.push({ recipient: "CLASS_TEACHER", label: messageRecipientLabel("CLASS_TEACHER", { secondary: placement.secondary ?? false }), name: placement.classTeacher.name, userId: placement.classTeacher.id });
  }
  for (const r of ["BURSAR", "PRINCIPAL", "HEAD_TEACHER", "ADMIN", "OFFICE"] as const) {
    if (already.has(r)) continue;
    if ((await holdersOf(db, schoolId, r)).length === 0) continue;
    out.push({ recipient: r, label: messageRecipientLabel(r), name: null, userId: null });
  }
  return out;
}

function isUnread(thread: { lastMessageBy: string; lastMessageAt: Date }, lastReadAt: Date | undefined): boolean {
  return thread.lastMessageBy === "GUARDIAN" && (!lastReadAt || lastReadAt < thread.lastMessageAt);
}

async function countUnread(db: Db, userId: string, visible: Prisma.MessageThreadWhereInput): Promise<number> {
  const rows = await db.messageThread.findMany({
    where: { AND: [visible, { status: "OPEN", lastMessageBy: "GUARDIAN" }] },
    select: { lastMessageAt: true, lastMessageBy: true, reads: { where: { readerKind: "STAFF", readerId: userId }, select: { lastReadAt: true } } },
    take: 500,
  });
  return rows.filter((r) => isUnread(r, r.reads[0]?.lastReadAt)).length;
}

export async function markRead(db: Db, schoolId: string, threadId: string, userId: string, at = new Date()): Promise<void> {
  await db.messageRead.upsert({
    where: { threadId_readerKind_readerId: { threadId, readerKind: "STAFF", readerId: userId } },
    create: { schoolId, threadId, readerKind: "STAFF", readerId: userId, lastReadAt: at },
    update: { lastReadAt: at },
  });
}

async function userNames(db: Db, schoolId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (wanted.length === 0) return new Map();
  const users = await db.user.findMany({ where: { schoolId, id: { in: wanted } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
}

function target(recipient: MessageRecipient, userId: string | null, names: Map<string, string>): string {
  if (recipient === "CLASS_TEACHER") return `Class teacher${userId && names.get(userId) ? ` (${names.get(userId)})` : ""}`;
  return messageRecipientLabel(recipient);
}

function summary(r: ThreadRow, names: Map<string, string>, unread: boolean): StaffMessageThreadSummaryDto {
  const guardianName = `${r.guardian.firstName} ${r.guardian.lastName}`.trim();
  const childName = r.student ? `${r.student.firstName} ${r.student.lastName}`.trim() : null;
  return {
    id: r.id,
    subject: r.subject,
    withLabel: childName ? `${guardianName}, about ${childName}` : guardianName,
    childName,
    guardianName,
    status: r.status as "OPEN" | "CLOSED",
    lastMessageAt: r.lastMessageAt,
    lastMessageBy: r.lastMessageBy as "GUARDIAN" | "STAFF",
    unread,
    addressedTo: [target(r.recipient, r.recipientUserId, names), ...r.passes.map((p) => target(p.recipient, p.recipientUserId, names))],
    handledBy: r.handledByUserId ? (names.get(r.handledByUserId) ?? "A member of staff") : null,
  };
}

async function audit(db: Db, authCtx: AuthContext, req: RequestContext, action: string, threadId: string, metadata: Record<string, unknown>) {
  await db.auditLog.create({
    data: {
      schoolId: authCtx.schoolId,
      userId: authCtx.userId,
      action,
      entityType: "message_thread",
      entityId: threadId,
      ipAddress: req.ipAddress,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}
