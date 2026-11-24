import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { withTenant } from "@school-kit/db";
import { z } from "zod";

const profileSchema = z.object({
  accountId: z.string().regex(/^[a-z0-9_-]{8,64}$/),
  schoolId: z.string().uuid(),
  signatureHeader: z.string().regex(/^x-[a-z0-9-]{1,62}$/),
  algorithm: z.enum(["sha256", "sha512"]),
  secret: z.string().min(16),
  verificationEvidence: z.string().trim().min(1),
  verifiedAt: z.string().datetime({ offset: true }),
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
});

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
    await withTenant(profile.schoolId, (db) => db.messagingTermiiEvent.createMany({
      skipDuplicates: true,
      data: {
        id: randomUUID(), schoolId: profile.schoolId, accountId: profile.accountId,
        reportId: parsed.data.id, providerRef: parsed.data.message_id, state,
      },
    }));
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

  async reconcile(profile: TermiiReportProfile): Promise<void> {
    const { schoolId, accountId } = profile;
    await withTenant(schoolId, async (db) => {
      const rows = await db.$queryRaw<{ id: string; provider_ref: string; state: State; received_at: Date }[]>`
        SELECT e.id, e.provider_ref, e.state, e.received_at FROM messaging_termii_events e
        WHERE e.school_id = ${schoolId} AND e.account_id = ${accountId} AND e.processed_at IS NULL
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
    }, { label: "termii-report-reconcile", timeoutMs: 15_000 });
  }
}
