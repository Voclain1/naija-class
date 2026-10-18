import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Resend } from "resend";

import { basePrisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  NotFoundError,
  UnauthorizedError,
  type EmailUnsubscribeInput,
  type EmailUnsubscribeQuery,
  type EmailUnsubscribeStatusDto,
  type PortalEmailPreferencesDto,
  type PortalEmailPreferencesInput,
} from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { unsubscribeTokenValid } from "./announcement-email.shared.js";

// Phase 9 / CP8.3 — the family's say over announcement emails, and what the
// mail service reports back (docs/modules/phase-9.md §17.11).
//
//   * The unsubscribe link (public): the school by its slug — `schools` has
//     no RLS, which is why basePrisma reads it — and the address, proved by
//     an HMAC no other school or address shares. The write runs under that
//     school's GUC. It stops ANNOUNCEMENT emails only.
//   * The portal switch: the same, for a signed-in parent's own address.
//   * The Resend webhook: signed (RESEND_WEBHOOK_SECRET); the school comes
//     from the tag set when sending. A hard bounce or a complaint stops all
//     non-essential email from that school to that address.
//
// No address, payload or text reaches a log line.

type Db = PrismaClient;

interface RequestContext {
  ipAddress: string | null;
}

/** The parts of a Resend webhook this service reads. */
interface ResendEvent {
  type: string;
  data?: { email_id?: string; tags?: Record<string, string> | { name: string; value: string }[]; bounce?: { type?: string } };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class EmailPreferencesService {
  /** What the unsubscribe page shows. */
  async status(q: EmailUnsubscribeQuery): Promise<EmailUnsubscribeStatusDto> {
    const school = await this.resolve(q);
    const subscribed = await withTenant(school.id, async (db) => !(await suppressed(db, school.id, q.e.toLowerCase(), "ANNOUNCEMENTS")));
    return { schoolName: school.name, subscribed };
  }

  /** Unsubscribe (or undo), from the link or the one-click header. */
  async set(input: EmailUnsubscribeInput, req: RequestContext): Promise<EmailUnsubscribeStatusDto> {
    const school = await this.resolve(input);
    const email = input.e.toLowerCase();
    await withTenant(school.id, (db) => setAnnouncements(db, school.id, email, input.subscribe, req, null));
    return { schoolName: school.name, subscribed: input.subscribe };
  }

  async portalGet(g: GuardianAuthContext): Promise<PortalEmailPreferencesDto> {
    return withTenant(g.schoolId, async (db) => {
      const email = await guardianEmail(db, g);
      if (!email) return { email: null, announcements: false, blocked: false };
      const rows = await db.emailSuppression.findMany({ where: { schoolId: g.schoolId, email }, select: { scope: true } });
      const blocked = rows.some((r) => r.scope === "ALL");
      return { email, announcements: !blocked && !rows.some((r) => r.scope === "ANNOUNCEMENTS"), blocked };
    });
  }

  async portalSet(g: GuardianAuthContext, input: PortalEmailPreferencesInput, req: RequestContext): Promise<PortalEmailPreferencesDto> {
    await withTenant(g.schoolId, async (db) => {
      const email = await guardianEmail(db, g);
      if (!email) throw new NotFoundError("The school holds no email address for you.");
      await setAnnouncements(db, g.schoolId, email, input.announcements, req, g.guardianId);
    });
    return this.portalGet(g);
  }

  /** POST /webhooks/resend. Returns quietly for anything it does not act on. */
  async webhook(rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>): Promise<void> {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException("Email webhooks are not set up on this server.");
    const one = (name: string) => {
      const v = headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    let event: ResendEvent;
    try {
      event = new Resend("re_webhook_verify_only").webhooks.verify({
        payload: rawBody?.toString("utf8") ?? "",
        headers: { id: one("svix-id") ?? one("webhook-id") ?? "", timestamp: one("svix-timestamp") ?? one("webhook-timestamp") ?? "", signature: one("svix-signature") ?? one("webhook-signature") ?? "" },
        webhookSecret: secret,
      }) as ResendEvent;
    } catch {
      throw new UnauthorizedError("INVALID_SIGNATURE", "Invalid webhook signature.");
    }

    const status =
      event.type === "email.delivered" ? "DELIVERED" : event.type === "email.bounced" ? "BOUNCED" : event.type === "email.complained" ? "COMPLAINED" : null;
    const providerId = event.data?.email_id;
    const schoolId = tag(event.data?.tags, "school");
    if (!status || !providerId || !schoolId || !UUID_RE.test(schoolId)) return;
    const school = await basePrisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) return;

    await withTenant(schoolId, async (db) => {
      const row = await db.announcementEmail.findFirst({ where: { schoolId, providerId }, select: { id: true, email: true, status: true } });
      if (!row) return;
      // Delivered never overwrites a bounce or a complaint that arrived first.
      if (status === "DELIVERED" && row.status !== "SENT") return;
      await db.announcementEmail.update({ where: { id: row.id }, data: { status } });
      const hard = status === "COMPLAINED" || (status === "BOUNCED" && (event.data?.bounce?.type ?? "").toLowerCase() === "permanent");
      if (hard) {
        await db.emailSuppression.upsert({
          where: { schoolId_email_scope: { schoolId, email: row.email, scope: "ALL" } },
          create: { schoolId, email: row.email, scope: "ALL", reason: status === "COMPLAINED" ? "COMPLAINED" : "BOUNCED" },
          update: {},
        });
      }
    });
  }

  private async resolve(q: EmailUnsubscribeQuery): Promise<{ id: string; name: string }> {
    const school = await basePrisma.school.findUnique({ where: { slug: q.s }, select: { id: true, name: true } });
    // One answer for a wrong school, a wrong address and a wrong token.
    if (!school || !unsubscribeTokenValid(school.id, q.e, q.t)) throw new NotFoundError("This link is not valid.");
    return school;
  }
}

async function guardianEmail(db: Db, g: GuardianAuthContext): Promise<string | null> {
  const row = await db.guardian.findFirst({ where: { id: g.guardianId, schoolId: g.schoolId }, select: { email: true } });
  return row?.email?.trim() ? row.email.trim().toLowerCase() : null;
}

async function suppressed(db: Db, schoolId: string, email: string, scope: "ANNOUNCEMENTS" | "ALL"): Promise<boolean> {
  return (await db.emailSuppression.count({ where: { schoolId, email, scope } })) > 0;
}

async function setAnnouncements(db: Db, schoolId: string, email: string, on: boolean, req: RequestContext, guardianId: string | null): Promise<void> {
  if (on) {
    await db.emailSuppression.deleteMany({ where: { schoolId, email, scope: "ANNOUNCEMENTS" } });
  } else {
    await db.emailSuppression.upsert({
      where: { schoolId_email_scope: { schoolId, email, scope: "ANNOUNCEMENTS" } },
      create: { schoolId, email, scope: "ANNOUNCEMENTS", reason: "UNSUBSCRIBED" },
      update: {},
    });
  }
  await db.auditLog.create({
    data: {
      schoolId,
      userId: null,
      action: on ? "email.announcements-on" : "email.announcements-off",
      entityType: "email_preference",
      entityId: guardianId,
      ipAddress: req.ipAddress,
      metadata: { from: guardianId ? "portal" : "link" },
    },
  });
}

type Tags = Record<string, string> | { name: string; value: string }[] | undefined;

function tag(tags: Tags, name: string): string | undefined {
  if (!tags) return undefined;
  if (Array.isArray(tags)) return tags.find((t) => t.name === name)?.value;
  return (tags as Record<string, string>)[name];
}
