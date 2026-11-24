import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { basePrisma, withTenant, type PrismaClient } from "@school-kit/db";
import { z } from "zod";

import { escalateStaleMessagingHolds, reconcileNotificationReservation } from "./messaging-wallet";

const profileSchema = z.object({
  accountId: z.string().regex(/^[a-z0-9_-]{8,64}$/),
  schoolId: z.string().uuid().optional(), // Legacy profile field, ignored for routing.
  signatureHeader: z.string().regex(/^x-[a-z0-9-]{1,62}$/),
  algorithm: z.enum(["sha256", "sha512"]),
  secret: z.string().min(16),
  verificationEvidence: z.string().trim().min(1),
  verifiedAt: z.string().datetime({ offset: true }),
  billing: z.object({
    currency: z.literal("NGN"),
    unit: z.enum(["KOBO", "NAIRA"]),
    finalStates: z.array(z.enum(["DELIVERED", "FAILED"])).min(1).max(2),
    zeroIsFinal: z.boolean(),
    contractRef: z.string().regex(/^[A-Za-z0-9._/-]{1,120}$/),
  }).strict().optional(),
}).strict();

export type TermiiReportProfile = z.infer<typeof profileSchema>;
type State = "SENT" | "DELIVERED" | "FAILED";
const ranks: Record<State, number> = { SENT: 1, FAILED: 2, DELIVERED: 3 };

const states = new Map<string, State>([
  ["message sent", "SENT"], ["delivered", "DELIVERED"], ["message delivered to handset", "DELIVERED"],
  ["dnd active on phone number", "FAILED"], ["message failed", "FAILED"], ["rejected", "FAILED"], ["expired", "FAILED"],
]);

const reportSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  message_id: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  channel: z.enum(["dnd", "generic"]),
  status: z.string().trim().max(120),
  cost: z.unknown().optional(),
});

function billingCharge(profile: TermiiReportProfile, state: State, cost: unknown): number | null {
  const billing = profile.billing;
  if (!billing || state === "SENT" || !billing.finalStates.includes(state) || typeof cost !== "string") return null;
  const match = (billing.unit === "KOBO" ? /^(0|[1-9]\d{0,9})$/ : /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/).exec(cost);
  if (!match) return null;
  const amount = billing.unit === "KOBO" ? BigInt(match[1]!)
    : BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return amount <= 2_147_483_647n && (amount > 0n || billing.zeroIsFinal) ? Number(amount) : null;
}

export function termiiReportSignatureMatches(
  profile: TermiiReportProfile,
  body: Buffer | undefined,
  signature: unknown,
): boolean {
  if (!body || typeof signature !== "string" || !/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = createHmac(profile.algorithm, profile.secret).update(body).digest();
  return signature.length === expected.length * 2 && timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

@Injectable()
export class TermiiReportsService {
  private readonly logger = new Logger(TermiiReportsService.name);

  constructor(private readonly config: ConfigService) {}

  profiles(): TermiiReportProfile[] {
    if (this.config.get<string>("MESSAGING_TERMII_REPORTS_ENABLED") !== "on") return [];
    let json: unknown;
    try {
      json = JSON.parse(this.config.get<string>("MESSAGING_TERMII_REPORT_PROFILES") ?? "");
    } catch {
      return [];
    }
    const result = z.array(profileSchema).max(100).safeParse(json);
    if (!result.success) return [];
    const profiles = result.data;
    // Each signing secret must be dedicated. Reusing one would allow a valid
    // report from one account to authenticate against another account's URL.
    if (new Set(profiles.map(({ accountId }) => accountId)).size !== profiles.length ||
        new Set(profiles.map(({ secret }) => secret)).size !== profiles.length) return [];
    return profiles.filter(({ verifiedAt }) => Date.parse(verifiedAt) <= Date.now());
  }

  async ingest(profile: TermiiReportProfile, payload: unknown): Promise<void> {
    const parsed = reportSchema.safeParse(payload);
    if (!parsed.success) return;
    const state = states.get(parsed.data.status.toLowerCase());
    if (!state) return;
    const chargedKobo = billingCharge(profile, state, parsed.data.cost);
    await basePrisma.messagingTermiiInbox.createMany({
      skipDuplicates: true,
      data: {
        accountId: profile.accountId, reportId: parsed.data.id, providerRef: parsed.data.message_id, state, chargedKobo,
        billingContractRef: chargedKobo === null ? null : profile.billing?.contractRef,
      },
    });
  }

  @Cron("*/1 * * * *", { waitForCompletion: true })
  async tick(): Promise<void> {
    for (const profile of this.profiles()) {
      try {
        await this.reconcile(profile);
      } catch {
        this.logger.error("Termii delivery report reconciliation failed");
      }
    }
  }

  private escalationCursor: string | undefined;

  // This investigation job also runs while the provider callback is disabled.
  @Cron("*/5 * * * *", { waitForCompletion: true })
  async escalateHolds(): Promise<void> {
    const schools = await basePrisma.school.findMany({
      where: { deletionStartedAt: null, ...(this.escalationCursor && { id: { gt: this.escalationCursor } }) },
      select: { id: true }, take: 100, orderBy: { id: "asc" },
    });
    this.escalationCursor = schools.length === 100 ? schools.at(-1)?.id : undefined;
    for (const { id } of schools) {
      try {
        await escalateStaleMessagingHolds(id);
      } catch {
        this.logger.warn("Messaging wallet investigation sweep could not process a school");
      }
    }
  }

  async reconcile(profile: TermiiReportProfile): Promise<void> {
    const { accountId } = profile;
    const inbox = await basePrisma.messagingTermiiInbox.findMany({
      where: { accountId, nextAttemptAt: { lte: new Date() } },
      orderBy: [{ nextAttemptAt: "asc" }, { receivedAt: "asc" }],
      take: 100,
    });
    for (const event of inbox) {
      const { reportId, providerRef, state, receivedAt, chargedKobo, billingContractRef } = event;
      const key = { accountId, reportId, providerRef, state };
      const [match] = await basePrisma.$queryRaw<{ school_id: string | null }[]>`
        SELECT school_id FROM messaging_resolve_termii_school(${accountId}, ${providerRef})`;
      if (!match?.school_id) {
        // A recorded collision is final for this event even if one of the
        // deliveries is later deleted. A missing reference may still appear.
        const nextAttemptAt = match ? new Date("9999-01-01T00:00:00Z") : new Date(Date.now() + 60_000);
        await basePrisma.messagingTermiiInbox.updateMany({
          where: key, data: { nextAttemptAt },
        });
        continue;
      }
      const schoolId = match.school_id;
      await withTenant(schoolId, async (db) => {
        await db.messagingTermiiEvent.createMany({
          skipDuplicates: true,
          data: { ...key, id: randomUUID(), schoolId, receivedAt },
        });
        await this.applyReports(db, accountId, schoolId, providerRef);
      });
      if (chargedKobo !== null && billingContractRef && profile.billing?.contractRef === billingContractRef) {
        const delivery = await withTenant(schoolId, (db) => db.notificationDelivery.findFirst({
          where: { schoolId, channel: "SMS", providerAccountId: accountId, providerRef, dispatchState: { in: ["ACCEPTED", "UNKNOWN"] } },
          select: { id: true },
        }));
        if (!delivery) {
          await basePrisma.messagingTermiiInbox.updateMany({
            where: key, data: { nextAttemptAt: new Date(Date.now() + 60_000) },
          });
          continue;
        }
        await reconcileNotificationReservation({
          schoolId, deliveryId: delivery.id, operatorId: null, resolution: chargedKobo === 0 ? "RELEASE" : "SETTLE",
          providerChargedKobo: BigInt(chargedKobo), evidenceRef: `termii:${accountId}:${reportId}:${state}`,
          verifiedTermiiReport: { accountId, providerRef, contractRef: billingContractRef },
        });
      }
      await basePrisma.messagingTermiiInbox.deleteMany({ where: key });
    }
    // Drain already-routed rows after a restart and support legacy profiles.
    const legacySchoolId = profile.schoolId;
    if (legacySchoolId) await withTenant(legacySchoolId, (db) => this.applyReports(db, accountId, legacySchoolId));
  }

  private async applyReports(db: PrismaClient, accountId: string, schoolId: string, providerRef: string | null = null): Promise<void> {
    const rows = await db.$queryRaw<{ id: string; provider_ref: string; state: State; received_at: Date }[]>`
      SELECT e.id, e.provider_ref, e.state, e.received_at FROM messaging_termii_events e
      WHERE e.school_id = ${schoolId} AND e.account_id = ${accountId} AND e.processed_at IS NULL
        AND (${providerRef}::text IS NULL OR e.provider_ref = ${providerRef})
        AND EXISTS (
          SELECT 1 FROM notification_deliveries d WHERE d.school_id = ${schoolId} AND d.channel = 'SMS'
            AND d.provider_account_id = ${accountId} AND d.provider_ref = e.provider_ref
        )
      ORDER BY e.provider_ref, e.received_at, e.id LIMIT 100 FOR UPDATE OF e SKIP LOCKED`;
    for (const row of rows) {
      await db.$executeRaw`
        UPDATE notification_deliveries SET provider_state = ${row.state}, provider_state_at = ${row.received_at}
        WHERE school_id = ${schoolId} AND channel = 'SMS' AND provider_account_id = ${accountId}
          AND provider_ref = ${row.provider_ref}
          AND (CASE provider_state WHEN 'SENT' THEN 1 WHEN 'FAILED' THEN 2 WHEN 'DELIVERED' THEN 3 ELSE 0 END) < ${ranks[row.state]}`;
      await db.messagingTermiiEvent.updateMany({ where: { schoolId, id: row.id }, data: { processedAt: new Date() } });
    }
  }
}
