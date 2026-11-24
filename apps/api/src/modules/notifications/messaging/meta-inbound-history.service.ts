import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, type MessagingInboundHistory } from "@school-kit/types";
import { z } from "zod";

import type { AuthContext } from "../../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../../common/auth/role-check";
import { normalizeGuardianWhatsAppPhone, WHATSAPP_CONSENT_VERSION } from "./guardian-messaging-consent.service";
import { metaTokenKey, openMetaToken, sealMetaToken } from "./meta-credentials";

const retentionSchema = z.record(z.string().uuid(), z.number().int().min(1).max(90));
const aad = (guardianId: string, providerRef: string) => `whatsapp-inbound:${guardianId}:${providerRef}`;

@Injectable()
export class MetaInboundHistoryService {
  private cursor: string | undefined;

  constructor(private readonly config: ConfigService) {}

  private days(schoolId: string): number | undefined {
    if (this.config.get<string>("MESSAGING_META_INBOUND_HISTORY_ENABLED") !== "on") return undefined;
    try {
      const limits = retentionSchema.safeParse(JSON.parse(this.config.get("MESSAGING_META_INBOUND_RETENTION_DAYS") ?? "{}"));
      return limits.success ? limits.data[schoolId] : undefined;
    } catch {
      return undefined;
    }
  }

  async ingest(input: {
    schoolId: string; wabaId: string; phoneNumberId: string; providerRef: unknown;
    from: string; text: string; occurredAt: Date;
  }): Promise<void> {
    const { schoolId, wabaId, phoneNumberId, providerRef, from, occurredAt } = input;
    const text = input.text.trim();
    const days = this.days(schoolId);
    const key = metaTokenKey(this.config.get<string>("MESSAGING_META_INBOUND_HISTORY_KEY"));
    if (!days || !key || typeof providerRef !== "string" || !/^wamid\.[A-Za-z0-9_+=/-]{1,480}$/.test(providerRef) ||
        !/^[1-9]\d{7,14}$/.test(from) || !text || text.length > 1600 ||
        /^(?:SCHOOLKIT\s+CONSENT\b|STOP$|UNSUBSCRIBE$|\d{6}$)/i.test(text)) return;

    const now = new Date();
    const expiresAt = new Date(Math.min(now.getTime(), occurredAt.getTime()) + days * 86_400_000);
    if (expiresAt <= now) return;
    await withTenant(schoolId, async (db) => {
      await db.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
      const binding = await db.messagingSchoolMetaConnection.findFirst({
        where: {
          schoolId, wabaId, phoneNumberId, disconnectedAt: null, activationPending: false,
          school: { status: "ACTIVE", suspendedAt: null, deletionStartedAt: null },
        },
        select: { connectedAt: true },
      });
      if (!binding || binding.connectedAt.getTime() > occurredAt.getTime() + 999) return;
      const contacts = await db.messagingGuardianConsent.findMany({
        where: {
          schoolId, phone: from, consentVersion: WHATSAPP_CONSENT_VERSION,
          verifiedAt: { lte: new Date(occurredAt.getTime() + 999) }, withdrawnAt: null,
          guardian: { portalDisabledAt: null },
        },
        select: { guardianId: true, guardian: { select: { phone: true } } }, take: 2,
      });
      if (contacts.length !== 1 || normalizeGuardianWhatsAppPhone(contacts[0]!.guardian.phone) !== from) return;
      const { guardianId } = contacts[0]!;
      await db.messagingInboundMessage.createMany({
        skipDuplicates: true,
        data: {
          id: randomUUID(), schoolId, guardianId, providerRef, occurredAt, expiresAt,
          encryptedText: sealMetaToken(key, schoolId, aad(guardianId, providerRef), text),
        },
      });
    });
  }

  async history(auth: AuthContext, guardianId: string): Promise<MessagingInboundHistory> {
    await assertUserActiveAndHasOneOf(auth, ["owner"]);
    const key = metaTokenKey(this.config.get<string>("MESSAGING_META_INBOUND_HISTORY_KEY"));
    const days = this.days(auth.schoolId);
    if (!days || !key) throw new ForbiddenError("WhatsApp conversation history is unavailable.");
    const now = new Date();
    return withTenant(auth.schoolId, async (db) => {
      const rows = await db.messagingInboundMessage.findMany({
        where: {
          schoolId: auth.schoolId, guardianId, expiresAt: { gt: now },
          occurredAt: { gt: new Date(now.getTime() - days * 86_400_000) },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 51,
      });
      if (rows.length) await db.auditLog.create({ data: {
        schoolId: auth.schoolId, userId: auth.userId, action: "messaging.whatsapp.history_view",
        entityType: "guardian", entityId: guardianId,
      } });
      return {
        items: rows.slice(0, 50).map((row) => ({
          id: row.id, occurredAt: row.occurredAt.toISOString(),
          text: openMetaToken(key, auth.schoolId, aad(guardianId, row.providerRef), row.encryptedText),
        })),
        truncated: rows.length > 50,
      };
    });
  }

  @Cron("*/10 * * * *", { waitForCompletion: true })
  async purgeExpired(): Promise<void> {
    const schools = await basePrisma.school.findMany({
      where: this.cursor ? { id: { gt: this.cursor } } : undefined,
      select: { id: true }, orderBy: { id: "asc" }, take: 100,
    });
    this.cursor = schools.length === 100 ? schools.at(-1)?.id : undefined;
    const now = new Date();
    for (const { id: schoolId } of schools) {
      const days = this.days(schoolId);
      await withTenant(schoolId, (db) => db.messagingInboundMessage.deleteMany({
        where: { schoolId, OR: [
          { expiresAt: { lte: now } },
          ...(days ? [{ occurredAt: { lte: new Date(now.getTime() - days * 86_400_000) } }] : []),
        ] },
      }));
    }
  }
}
