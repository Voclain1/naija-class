import { Injectable } from "@nestjs/common";

import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  MESSAGE_LIMITS,
  messageRecipientLabel,
  NotFoundError,
  RateLimitError,
  ValidationError,
  type FlagMessageInput,
  type MessageRecipientOptionDto,
  type MessageThreadSummaryDto,
  type PortalMessageListDto,
  type PortalMessageThreadDto,
  type ReplyMessageInput,
  type StagedMessageImageDto,
  type StartMessageInput,
} from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { StorageService } from "../../common/storage/storage.service.js";
import { MessageAlertsService } from "./message-alerts.service.js";
import { attachMessageImages, checkSafeguarding, flagThread, messageImageLinks, stageMessageImage } from "./message-safety.js";
import { childPlacement, holdersOf, lagosDayStart, staffAuthorLabel } from "./messages.shared.js";

// Phase 9 / CP8.1 — the family's side of messaging (docs/modules/phase-9.md
// §17.8). A guardian writes to ONE recipient about one of their own children
// or in general, and sees only their own conversations. A recipient nobody
// holds is not offered. Limits: 5 new conversations a Lagos day and 30
// messages an hour per guardian. Nothing a parent types reaches an audit row
// or a log line.
//
// CP8.2 (§17.10): photos on a message, and "Report this conversation", which
// opens it to the owner and admins. The family sees only that they reported
// it, never a flag the school or a safeguarding word set.

type Db = PrismaClient;

interface RequestContext {
  ipAddress: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class PortalMessagesService {
  constructor(
    private readonly alerts: MessageAlertsService,
    private readonly storage: StorageService,
  ) {}

  /** CP8.2: stages one photo for the family's next message. */
  async stageImage(guardianCtx: GuardianAuthContext, buffer: Buffer | undefined): Promise<StagedMessageImageDto> {
    return stageMessageImage(this.storage, guardianCtx.schoolId, { kind: "GUARDIAN", id: guardianCtx.guardianId }, buffer);
  }

  /** CP8.2: the family reports a conversation to the school's owner and admins. */
  async report(guardianCtx: GuardianAuthContext, id: string, input: FlagMessageInput, req: RequestContext): Promise<PortalMessageThreadDto> {
    const result = await withTenant(guardianCtx.schoolId, async (db) => {
      const thread = await ownThread(db, guardianCtx, id);
      if (thread.flaggedAt && thread.flaggedByKind === "GUARDIAN") throw new ConflictError("MESSAGE_REPORTED", "You have already reported this conversation.");
      const flag = { reason: "REPORTED" as const, note: input.note ?? null, byKind: "GUARDIAN" as const, byId: guardianCtx.guardianId };
      let fresh = await flagThread(db, guardianCtx.schoolId, id, flag);
      if (!fresh) {
        // Already flagged by the school or a safeguarding word: the family's
        // report replaces the reason, so the admins read the parent's words.
        await db.messageThread.update({
          where: { id },
          data: { flagReason: flag.reason, flagNote: flag.note, flaggedByKind: flag.byKind, flaggedById: flag.byId },
        });
        fresh = true;
      }
      await audit(db, guardianCtx, req, "message.report", id, { note: input.note !== undefined });
      return fresh;
    });
    if (result) await this.alerts.toAdmins(guardianCtx.schoolId, id, "REPORTED", null);
    return this.get(guardianCtx, id);
  }

  /** Whom the family may write to, about this child or (studentId null) in general. */
  async recipients(guardianCtx: GuardianAuthContext, studentId: string | null): Promise<MessageRecipientOptionDto[]> {
    return withTenant(guardianCtx.schoolId, async (db) => (await recipientOptions(db, guardianCtx, studentId)).map(({ userId: _u, ...o }) => o));
  }

  async list(guardianCtx: GuardianAuthContext): Promise<PortalMessageListDto> {
    return withTenant(guardianCtx.schoolId, async (db) => {
      const rows = await db.messageThread.findMany({
        where: { schoolId: guardianCtx.schoolId, guardianId: guardianCtx.guardianId },
        orderBy: { lastMessageAt: "desc" },
        take: 100,
        select: {
          ...SUMMARY_SELECT,
          reads: { where: { readerKind: "GUARDIAN", readerId: guardianCtx.guardianId }, select: { lastReadAt: true } },
        },
      });
      const school = await db.school.findUniqueOrThrow({ where: { id: guardianCtx.schoolId }, select: { name: true } });
      const items = await Promise.all(rows.map((r) => familySummary(db, guardianCtx.schoolId, school.name, r, unreadForFamily(r, r.reads[0]?.lastReadAt))));
      return { items, unread: items.filter((i) => i.unread && i.status === "OPEN").length };
    });
  }

  /** One of the family's own conversations. Opening it marks it read. */
  async get(guardianCtx: GuardianAuthContext, id: string): Promise<PortalMessageThreadDto> {
    return withTenant(guardianCtx.schoolId, async (db) => {
      const thread = await ownThread(db, guardianCtx, id);
      await markFamilyRead(db, guardianCtx, id);
      return this.detail(db, guardianCtx, thread);
    });
  }

  async start(guardianCtx: GuardianAuthContext, input: StartMessageInput, req: RequestContext): Promise<PortalMessageThreadDto> {
    const created = await withTenant(guardianCtx.schoolId, async (db) => {
      const startedToday = await db.messageThread.count({
        where: { schoolId: guardianCtx.schoolId, guardianId: guardianCtx.guardianId, startedByUserId: null, createdAt: { gte: lagosDayStart() } },
      });
      if (startedToday >= MESSAGE_LIMITS.newPerDay) {
        throw new RateLimitError("MESSAGE_LIMIT", `You can start ${MESSAGE_LIMITS.newPerDay} conversations a day. Reply in an open one, or try again tomorrow.`);
      }
      const option = (await recipientOptions(db, guardianCtx, input.studentId)).find((o) => o.recipient === input.recipient);
      if (!option) throw new ValidationError("Choose who to write to.");
      const now = new Date();
      const thread = await db.messageThread.create({
        data: {
          schoolId: guardianCtx.schoolId,
          guardianId: guardianCtx.guardianId,
          studentId: input.studentId,
          recipient: input.recipient,
          recipientUserId: input.recipient === "CLASS_TEACHER" ? option.userId : null,
          subject: input.subject,
          lastMessageAt: now,
          lastMessageBy: "GUARDIAN",
        },
        select: { id: true },
      });
      const message = await db.message.create({
        data: { schoolId: guardianCtx.schoolId, threadId: thread.id, authorKind: "GUARDIAN", guardianId: guardianCtx.guardianId, body: input.body },
        select: { id: true },
      });
      await attachMessageImages(db, guardianCtx.schoolId, { kind: "GUARDIAN", id: guardianCtx.guardianId }, input.imageIds, message.id);
      const flagged = await checkSafeguarding(db, guardianCtx.schoolId, thread.id, message.id, input.body);
      await markFamilyRead(db, guardianCtx, thread.id, now);
      await audit(db, guardianCtx, req, "message.start", thread.id, { recipient: input.recipient, child: input.studentId !== null, images: input.imageIds.length });
      return { threadId: thread.id, messageId: message.id, flagged };
    });
    await this.alerts.toStaff(guardianCtx.schoolId, created.threadId, created.messageId);
    if (created.flagged) await this.alerts.toAdmins(guardianCtx.schoolId, created.threadId, "SAFEGUARDING_WORDS", null);
    return this.get(guardianCtx, created.threadId);
  }

  async reply(guardianCtx: GuardianAuthContext, id: string, input: ReplyMessageInput, req: RequestContext): Promise<PortalMessageThreadDto> {
    const sent = await withTenant(guardianCtx.schoolId, async (db) => {
      const thread = await ownThread(db, guardianCtx, id);
      if (thread.status !== "OPEN") throw new ConflictError("MESSAGE_CLOSED", "This conversation is closed. Start a new one if you need to.");
      const now = new Date();
      const recent = await db.message.count({
        where: { schoolId: guardianCtx.schoolId, guardianId: guardianCtx.guardianId, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
      });
      if (recent >= MESSAGE_LIMITS.perHour) throw new RateLimitError("MESSAGE_LIMIT", "You have sent a lot of messages in the last hour. Please wait a little.");
      const message = await db.message.create({
        data: { schoolId: guardianCtx.schoolId, threadId: id, authorKind: "GUARDIAN", guardianId: guardianCtx.guardianId, body: input.body },
        select: { id: true },
      });
      await attachMessageImages(db, guardianCtx.schoolId, { kind: "GUARDIAN", id: guardianCtx.guardianId }, input.imageIds, message.id);
      const flagged = await checkSafeguarding(db, guardianCtx.schoolId, id, message.id, input.body);
      await db.messageThread.update({ where: { id }, data: { lastMessageAt: now, lastMessageBy: "GUARDIAN" } });
      await markFamilyRead(db, guardianCtx, id, now);
      await audit(db, guardianCtx, req, "message.reply", id, { messageId: message.id, images: input.imageIds.length });
      return { messageId: message.id, flagged };
    });
    await this.alerts.toStaff(guardianCtx.schoolId, id, sent.messageId);
    if (sent.flagged) await this.alerts.toAdmins(guardianCtx.schoolId, id, "SAFEGUARDING_WORDS", null);
    return this.get(guardianCtx, id);
  }

  private async detail(db: Db, guardianCtx: GuardianAuthContext, thread: SummaryRow): Promise<PortalMessageThreadDto> {
    const school = await db.school.findUniqueOrThrow({ where: { id: guardianCtx.schoolId }, select: { name: true } });
    const messages = await db.message.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, authorKind: true, userId: true, asRecipient: true, body: true, createdAt: true },
    });
    const images = await messageImageLinks(db, this.storage, guardianCtx.schoolId, messages.map((m) => m.id));
    const writers = await db.user.findMany({
      where: { schoolId: guardianCtx.schoolId, id: { in: messages.map((m) => m.userId).filter((v): v is string => !!v) } },
      select: { id: true, firstName: true, lastName: true },
    });
    const writer = new Map(writers.map((w) => [w.id, w]));
    const placement = thread.student ? await childPlacement(db, guardianCtx.schoolId, thread.student.id) : null;
    const secondary = placement?.secondary ?? false;
    const lastFamily = [...messages].reverse().find((m) => m.authorKind === "GUARDIAN");
    const seenBy = lastFamily
      ? await db.messageRead.count({ where: { threadId: thread.id, readerKind: "STAFF", lastReadAt: { gte: lastFamily.createdAt } } })
      : 0;
    return {
      ...(await familySummary(db, guardianCtx.schoolId, school.name, thread, false)),
      messages: messages.map((m) => ({
        id: m.id,
        mine: m.authorKind === "GUARDIAN",
        author: m.authorKind === "GUARDIAN" ? "You" : staffAuthorLabel(m.asRecipient!, writer.get(m.userId!) ?? null, { secondary, schoolName: school.name }),
        body: m.body,
        images: images.get(m.id) ?? [],
        sentAt: m.createdAt,
      })),
      reported: thread.flaggedAt !== null && thread.flaggedByKind === "GUARDIAN",
      seen: Boolean(lastFamily) && seenBy > 0,
      closedAt: thread.closedAt,
    };
  }
}

const SUMMARY_SELECT = {
  id: true,
  subject: true,
  status: true,
  recipient: true,
  recipientUserId: true,
  lastMessageAt: true,
  lastMessageBy: true,
  closedAt: true,
  flaggedAt: true,
  flaggedByKind: true,
  student: { select: { id: true, firstName: true, lastName: true } },
} as const;

type SummaryRow = {
  id: string;
  subject: string;
  status: string;
  recipient: MessageRecipientOptionDto["recipient"];
  recipientUserId: string | null;
  lastMessageAt: Date;
  lastMessageBy: string;
  closedAt: Date | null;
  flaggedAt: Date | null;
  flaggedByKind: string | null;
  student: { id: string; firstName: string; lastName: string } | null;
};

async function familySummary(db: Db, schoolId: string, schoolName: string, r: SummaryRow, unread: boolean): Promise<MessageThreadSummaryDto> {
  let withLabel: string;
  if (r.recipient === "CLASS_TEACHER") {
    const placement = r.student ? await childPlacement(db, schoolId, r.student.id) : null;
    const teacher = r.recipientUserId ? await db.user.findFirst({ where: { id: r.recipientUserId, schoolId }, select: { firstName: true, lastName: true } }) : null;
    const label = messageRecipientLabel("CLASS_TEACHER", { secondary: placement?.secondary ?? false });
    withLabel = teacher ? `${teacher.firstName} ${teacher.lastName}`.trim() + `, ${label}` : label;
  } else {
    withLabel = messageRecipientLabel(r.recipient, { schoolName });
  }
  return {
    id: r.id,
    subject: r.subject,
    withLabel,
    childName: r.student ? `${r.student.firstName} ${r.student.lastName}`.trim() : null,
    status: r.status as "OPEN" | "CLOSED",
    lastMessageAt: r.lastMessageAt,
    lastMessageBy: r.lastMessageBy as "GUARDIAN" | "STAFF",
    unread,
  };
}

function unreadForFamily(r: { lastMessageBy: string; lastMessageAt: Date }, lastReadAt: Date | undefined): boolean {
  return r.lastMessageBy === "STAFF" && (!lastReadAt || lastReadAt < r.lastMessageAt);
}

/** The recipients this family may choose; a recipient nobody holds is not offered. */
async function recipientOptions(db: Db, guardianCtx: GuardianAuthContext, studentId: string | null): Promise<(MessageRecipientOptionDto & { userId: string | null })[]> {
  let secondary: boolean | null = null;
  const out: (MessageRecipientOptionDto & { userId: string | null })[] = [];
  if (studentId) {
    const link = await db.studentGuardian.findFirst({
      where: { guardianId: guardianCtx.guardianId, studentId, student: { schoolId: guardianCtx.schoolId } },
      select: { id: true },
    });
    if (!link) throw new NotFoundError("Child not found.");
    const placement = await childPlacement(db, guardianCtx.schoolId, studentId);
    secondary = placement.secondary;
    if (placement.classTeacher) {
      out.push({
        recipient: "CLASS_TEACHER",
        label: messageRecipientLabel("CLASS_TEACHER", { secondary: placement.secondary ?? false }),
        name: placement.classTeacher.name,
        userId: placement.classTeacher.id,
      });
    }
  }
  const school = await db.school.findUniqueOrThrow({ where: { id: guardianCtx.schoolId }, select: { name: true } });
  const heads: ("PRINCIPAL" | "HEAD_TEACHER")[] = secondary === null ? ["PRINCIPAL", "HEAD_TEACHER"] : secondary ? ["PRINCIPAL"] : ["HEAD_TEACHER"];
  for (const r of ["BURSAR", ...heads, "ADMIN", "OFFICE"] as const) {
    if ((await holdersOf(db, guardianCtx.schoolId, r)).length === 0) continue;
    out.push({ recipient: r, label: messageRecipientLabel(r, { schoolName: school.name }), name: null, userId: null });
  }
  return out;
}

async function ownThread(db: Db, guardianCtx: GuardianAuthContext, id: string): Promise<SummaryRow> {
  const thread = await db.messageThread.findFirst({
    where: { id, schoolId: guardianCtx.schoolId, guardianId: guardianCtx.guardianId },
    select: SUMMARY_SELECT,
  });
  if (!thread) throw new NotFoundError("Conversation not found.");
  return thread;
}

async function markFamilyRead(db: Db, guardianCtx: GuardianAuthContext, threadId: string, at = new Date()): Promise<void> {
  await db.messageRead.upsert({
    where: { threadId_readerKind_readerId: { threadId, readerKind: "GUARDIAN", readerId: guardianCtx.guardianId } },
    create: { schoolId: guardianCtx.schoolId, threadId, readerKind: "GUARDIAN", readerId: guardianCtx.guardianId, lastReadAt: at },
    update: { lastReadAt: at },
  });
}

async function audit(db: Db, guardianCtx: GuardianAuthContext, req: RequestContext, action: string, threadId: string, metadata: Record<string, unknown>) {
  await db.auditLog.create({
    data: {
      schoolId: guardianCtx.schoolId,
      userId: null,
      action,
      entityType: "message_thread",
      entityId: threadId,
      ipAddress: req.ipAddress,
      metadata: { ...metadata, guardianId: guardianCtx.guardianId },
    },
  });
}
