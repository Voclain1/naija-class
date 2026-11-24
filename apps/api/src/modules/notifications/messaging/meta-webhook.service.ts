import { randomUUID } from "node:crypto";

import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { basePrisma, withTenant } from "@school-kit/db";

import { GuardianMessagingConsentService } from "./guardian-messaging-consent.service";

type State = "SENT" | "DELIVERED" | "READ" | "FAILED";
interface Status {
  wabaId: string;
  phoneNumberId: string;
  providerRef: string;
  state: State;
  occurredAt: Date;
}

const STATES: Readonly<Record<string, State | undefined>> = {
  sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED",
};
const RANK: Record<State, number> = { SENT: 1, FAILED: 2, DELIVERED: 3, READ: 4 };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function providerId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,32}$/.test(value);
}

function statuses(payload: unknown): Status[] {
  const body = record(payload);
  if (body.object !== "whatsapp_business_account") return [];
  const normalized: Status[] = [];
  for (const entry of list(body.entry)) {
    const { id: wabaId, changes } = record(entry);
    if (!providerId(wabaId)) continue;
    for (const change of list(changes)) {
      const { field, value } = record(change);
      if (field !== "messages") continue;
      const event = record(value);
      const phoneNumberId = record(event.metadata).phone_number_id;
      if (event.messaging_product !== "whatsapp" || !providerId(phoneNumberId)) continue;
      for (const status of list(event.statuses)) {
        const { id, status: providerState, timestamp } = record(status);
        if (typeof id !== "string" || !/^wamid\.[A-Za-z0-9_+=/-]{1,480}$/.test(id) ||
            typeof providerState !== "string" || !Object.hasOwn(STATES, providerState) ||
            typeof timestamp !== "string" || !/^\d{9,10}$/.test(timestamp)) continue;
        const state = STATES[providerState];
        const timestampMs = Number(timestamp) * 1000;
        if (!state || timestampMs > Date.now() + 300_000) continue;
        normalized.push({ wabaId, phoneNumberId, providerRef: id, state, occurredAt: new Date(timestampMs) });
      }
    }
  }
  return normalized;
}

@Injectable()
export class MetaWebhookService {
  private readonly logger = new Logger(MetaWebhookService.name);
  private accountCursor: string | undefined;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly consent?: GuardianMessagingConsentService,
  ) {}

  /** Invoked only after raw-body authentication. Persists status data without message content or contacts. */
  async ingest(payload: unknown): Promise<void> {
    const byPhone = new Map<string, Status[]>();
    for (const event of statuses(payload)) {
      const group = byPhone.get(event.phoneNumberId) ?? [];
      group.push(event);
      byPhone.set(event.phoneNumberId, group);
    }
    for (const [phoneNumberId, events] of byPhone) {
      // Account directory is the only global read. Its IDs are provisioned
      // separately following a provider ownership check.
      const account = await basePrisma.messagingMetaAccount.findUnique({ where: { phoneNumberId } });
      if (!account) continue;
      const data = events.filter((event) => event.wabaId === account.wabaId)
        .map((event) => ({ ...event, id: randomUUID(), schoolId: account.schoolId }));
      if (data.length === 0) continue;
      await withTenant(account.schoolId, async (db) => {
        const binding = await db.messagingMetaAccount.findUnique({ where: { schoolId: account.schoolId } });
        if (binding?.phoneNumberId !== phoneNumberId || binding.wabaId !== account.wabaId) return;
        await db.messagingMetaEvent.createMany({ data, skipDuplicates: true });
      }, { label: "meta-webhook-ingest" });
    }
    await this.ingestAccountUpdates(payload);
    await this.ingestConsentCommands(payload);
  }

  private async ingestAccountUpdates(payload: unknown): Promise<void> {
    const body = record(payload);
    if (body.object !== "whatsapp_business_account") return;
    for (const entry of list(body.entry)) {
      const { id: wabaId, time, changes } = record(entry);
      if (!providerId(wabaId) || typeof time !== "number" || !Number.isSafeInteger(time) ||
          time <= 0 || time * 1000 > Date.now() + 300_000) continue;
      const change = list(changes).map(record).find(({ field, value }) => {
        const info = record(value);
        const supplied = record(info.waba_info).waba_id;
        return field === "account_update" && (supplied === undefined || supplied === wabaId) &&
          ["ACCOUNT_OFFBOARDED", "PARTNER_APP_UNINSTALLED", "PARTNER_REMOVED"].includes(String(info.event));
      });
      if (!change) continue;
      const accounts = await basePrisma.messagingMetaAccount.findMany({ where: { wabaId }, take: 2 });
      if (accounts.length !== 1) continue; // refuse an ambiguous shared routing entry
      const { schoolId, phoneNumberId } = accounts[0]!;
      await withTenant(schoolId, async (db) => {
        await db.$queryRaw`SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
        // An event older than a newly verified grant cannot offboard that grant.
        const changed = await db.messagingSchoolMetaConnection.updateMany({
          where: { schoolId, wabaId, phoneNumberId, connectedAt: { lte: new Date(time * 1000 + 999) }, disconnectedAt: null },
          data: { disconnectedAt: new Date(), activationPending: false },
        });
        if (!changed.count) return;
        await db.messagingMetaAccount.deleteMany({ where: { schoolId, wabaId, phoneNumberId } });
        await db.messagingGuardianConsent.updateMany({
          where: { schoolId },
          data: { withdrawnAt: new Date(), challengeHash: null, challengeIssuedAt: null, challengeExpiresAt: null },
        });
        await db.notificationDelivery.updateMany({
          where: { schoolId, channel: "WHATSAPP", dispatchState: "QUEUED" },
          data: { dispatchState: "CANCELLED", dispatchReason: "META_OFFBOARDED" },
        });
        await db.auditLog.create({ data: {
          schoolId, action: "messaging.meta.provider_offboard", entityType: "messaging_meta_connection", entityId: schoolId,
        } });
      });
    }
  }

  /** The parser runs only on the exact body authenticated by the controller. */
  private async ingestConsentCommands(payload: unknown): Promise<void> {
    if (!this.consent) return;
    const body = record(payload);
    if (body.object !== "whatsapp_business_account") return;
    for (const entry of list(body.entry)) {
      const { id: wabaId, changes } = record(entry);
      if (!providerId(wabaId)) continue;
      for (const change of list(changes)) {
        const { field, value } = record(change);
        if (field !== "messages") continue;
        const event = record(value);
        const phoneNumberId = record(event.metadata).phone_number_id;
        if (event.messaging_product !== "whatsapp" || !providerId(phoneNumberId) || !list(event.messages).length) continue;
        const account = await basePrisma.messagingMetaAccount.findUnique({ where: { phoneNumberId } });
        if (account?.wabaId !== wabaId) continue;
        for (const message of list(event.messages)) {
          const { type, from, timestamp, text } = record(message);
          const command = record(text).body;
          if (type !== "text" || typeof from !== "string" || typeof command !== "string" ||
              command.length > 100 || typeof timestamp !== "string" || !/^\d{9,10}$/.test(timestamp)) continue;
          const time = Number(timestamp) * 1000;
          if (time > Date.now() + 300_000) continue;
          await this.consent.applyVerifiedInbound({
            schoolId: account.schoolId, wabaId, phoneNumberId, from, text: command, occurredAt: new Date(time),
          });
        }
      }
    }
  }

  @Cron("*/1 * * * *", { waitForCompletion: true })
  async tick(): Promise<void> {
    if (this.config.get<string>("MESSAGING_META_WEBHOOK_ENABLED") !== "on") return;
    try {
      const accounts = await basePrisma.messagingMetaAccount.findMany({
        where: { ...(this.accountCursor ? { schoolId: { gt: this.accountCursor } } : {}) },
        select: { schoolId: true },
        orderBy: { schoolId: "asc" },
        take: 50,
      });
      this.accountCursor = accounts.length === 50 ? accounts.at(-1)?.schoolId : undefined;
      for (const { schoolId } of accounts) await this.reconcile(schoolId);
    } catch {
      this.logger.error("Meta status worker could not reconcile an inbox batch");
    }
  }

  async reconcile(schoolId: string): Promise<void> {
    await withTenant(schoolId, async (db) => {
      const rows = await db.$queryRaw<{
        id: string; provider_ref: string; phone_number_id: string; state: State; occurred_at: Date;
      }[]>`
        SELECT e.id, e.provider_ref, e.phone_number_id, e.state, e.occurred_at
        FROM messaging_meta_events e
        JOIN messaging_meta_accounts a ON a.school_id = e.school_id
          AND a.waba_id = e.waba_id AND a.phone_number_id = e.phone_number_id
        WHERE e.school_id = ${schoolId} AND e.processed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM notification_deliveries d WHERE d.school_id = e.school_id
              AND d.channel = 'WHATSAPP' AND d.provider_account_id = e.phone_number_id
              AND d.provider_ref = e.provider_ref
          )
        ORDER BY e.phone_number_id, e.provider_ref, e.occurred_at, e.id
        LIMIT 100 FOR UPDATE OF e SKIP LOCKED`;
      for (const event of rows) {
        await db.$executeRaw`
          UPDATE notification_deliveries
            SET provider_state = ${event.state}, provider_state_at = ${event.occurred_at}
          WHERE school_id = ${schoolId} AND channel = 'WHATSAPP'
            AND provider_account_id = ${event.phone_number_id} AND provider_ref = ${event.provider_ref}
            AND (CASE provider_state WHEN 'SENT' THEN 1 WHEN 'FAILED' THEN 2
               WHEN 'DELIVERED' THEN 3 WHEN 'READ' THEN 4 ELSE 0 END < ${RANK[event.state]}
              OR (provider_state = ${event.state} AND provider_state_at < ${event.occurred_at}))`;
        await db.messagingMetaEvent.updateMany({ where: { schoolId, id: event.id }, data: { processedAt: new Date() } });
      }
    }, { label: "meta-webhook-reconcile", timeoutMs: 15_000 });
  }
}
