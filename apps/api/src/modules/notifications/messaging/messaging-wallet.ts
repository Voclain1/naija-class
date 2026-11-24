import { randomUUID } from "node:crypto";

import { type PrismaClient, withTenant } from "@school-kit/db";
import { ConflictError, NotFoundError, type Kobo, type MessagingReconciliationReport } from "@school-kit/types";

import { effectiveMessagingSpendLimit } from "../../../common/messaging-spend-limits";

type EntryKind = "TOP_UP" | "RESERVE" | "SETTLE" | "RELEASE";
type Entry = { kind: EntryKind; amount_kobo: number; released_kobo: number };
type Balances = { availableKobo: bigint; reservedKobo: bigint };

const MAX_ENTRY_KOBO = 2_147_483_647n;

export interface MessagingSpendPolicy {
  paidSendingEnabled: boolean;
  schoolDailyKobo: bigint;
  platformDailyKobo: bigint;
}

function validAmount(amountKobo: bigint): void {
  if (amountKobo <= 0n || amountKobo > MAX_ENTRY_KOBO) throw new RangeError("Invalid wallet amount");
}

async function balances(db: PrismaClient, schoolId: string): Promise<Balances> {
  const [totals] = await db.$queryRaw<Balances[]>`
    SELECT COALESCE(SUM(CASE kind WHEN 'TOP_UP' THEN amount_kobo WHEN 'RELEASE' THEN amount_kobo
      WHEN 'RESERVE' THEN -amount_kobo WHEN 'SETTLE' THEN released_kobo ELSE 0 END), 0) AS "availableKobo",
      COALESCE(SUM(CASE kind WHEN 'RESERVE' THEN amount_kobo WHEN 'TOP_UP' THEN 0
        ELSE -(amount_kobo::bigint + released_kobo) END), 0)::bigint AS "reservedKobo"
    FROM messaging_wallet_entries WHERE school_id = ${schoolId}`;
  return totals!;
}

function inWallet<T>(schoolId: string, operation: (db: PrismaClient) => Promise<T>): Promise<T> {
  return withTenant(schoolId, async (db) => {
    // Serializes the balance check and append per school across API replicas.
    const [school] = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM schools WHERE id = ${schoolId} AND deletion_started_at IS NULL FOR UPDATE`;
    if (!school) throw new Error("Messaging wallet unavailable");
    return operation(db);
  }, { label: "messaging-wallet", timeoutMs: 15_000 });
}

async function append(db: PrismaClient, schoolId: string, kind: EntryKind, reference: string, amountKobo: bigint, releasedKobo = 0n) {
  return db.$executeRaw`
    INSERT INTO messaging_wallet_entries (id, school_id, reference, kind, amount_kobo, released_kobo)
    VALUES (${randomUUID()}, ${schoolId}, ${reference}, ${kind}, ${amountKobo}::integer, ${releasedKobo}::integer)
    ON CONFLICT DO NOTHING`;
}

export function getMessagingWallet(schoolId: string): Promise<Balances> {
  return withTenant(schoolId, (db) => balances(db, schoolId), { label: "messaging-wallet-read" });
}

/** Requires a committed, independently verified NGN top-up bound to this school. */
export function creditVerifiedMessagingTopUp(schoolId: string, reference: string, amountKobo: bigint) {
  validAmount(amountKobo);
  return inWallet(schoolId, async (db) => {
    if (await append(db, schoolId, "TOP_UP", reference, amountKobo)) return "CREDITED";
    const [previous] = await db.$queryRaw<Entry[]>`
      SELECT kind, amount_kobo, released_kobo FROM messaging_wallet_entries
      WHERE school_id = ${schoolId} AND reference = ${reference} AND kind = 'TOP_UP'`;
    return previous && BigInt(previous.amount_kobo) === amountKobo ? "ALREADY_CREDITED" : "CONFLICT";
  });
}

export function reserveMessagingCredit(
  schoolId: string,
  reference: string,
  amountKobo: bigint,
  policy?: MessagingSpendPolicy,
) {
  validAmount(amountKobo);
  if (!policy?.paidSendingEnabled || policy.schoolDailyKobo <= 0n || policy.platformDailyKobo <= 0n) {
    return Promise.resolve("SPENDING_DISABLED");
  }
  validAmount(policy.schoolDailyKobo);
  validAmount(policy.platformDailyKobo);
  return inWallet(schoolId, async (db) => {
    const entries = await db.$queryRaw<Entry[]>`
      SELECT kind, amount_kobo, released_kobo FROM messaging_wallet_entries
      WHERE school_id = ${schoolId} AND reference = ${reference} AND kind <> 'TOP_UP'`;
    const reserve = entries.find((entry) => entry.kind === "RESERVE");
    if (reserve) {
      return entries.length === 1 && BigInt(reserve.amount_kobo) === amountKobo ? "ALREADY_RESERVED" : "CONFLICT";
    }
    if ((await balances(db, schoolId)).availableKobo < amountKobo) return "INSUFFICIENT_CREDIT";
    const [daily] = await db.$queryRaw<{ day: string; schoolReserved: bigint }[]>`
      WITH today AS (SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date AS day)
      SELECT today.day::text AS day, COALESCE((
        SELECT SUM(amount_kobo) FROM messaging_wallet_entries
        WHERE school_id = ${schoolId} AND kind = 'RESERVE' AND
          (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Lagos')::date = today.day
      ), 0) AS "schoolReserved"
      FROM today`;
    const schoolLimit = await effectiveMessagingSpendLimit(schoolId, policy.schoolDailyKobo, db);
    if (!daily || daily.schoolReserved + amountKobo > schoolLimit) return "SPENDING_LIMIT";
    const platformLimit = await effectiveMessagingSpendLimit("platform", policy.platformDailyKobo, db);
    const consumed = await db.$executeRaw`
      INSERT INTO messaging_platform_reservations_daily (day, reserved_kobo)
      SELECT ${daily.day}::date, ${amountKobo}::bigint
      WHERE ${amountKobo}::bigint <= ${platformLimit}::bigint
      ON CONFLICT (day) DO UPDATE SET reserved_kobo =
        messaging_platform_reservations_daily.reserved_kobo + EXCLUDED.reserved_kobo
      WHERE messaging_platform_reservations_daily.reserved_kobo + EXCLUDED.reserved_kobo <= ${platformLimit}::bigint`;
    if (!consumed) return "SPENDING_LIMIT";
    await append(db, schoolId, "RESERVE", reference, amountKobo);
    return "RESERVED";
  });
}

/** Leave the reservation open while a provider outcome is uncertain. */
export function resolveMessagingCredit(schoolId: string, reference: string, resolution: "SETTLE" | "RELEASE") {
  return inWallet(schoolId, (db) => appendResolution(db, schoolId, reference, resolution));
}

async function appendResolution(
  db: PrismaClient, schoolId: string, reference: string, resolution: "SETTLE" | "RELEASE", actualCharge?: bigint,
) {
  const entries = await db.$queryRaw<Entry[]>`
    SELECT kind, amount_kobo, released_kobo FROM messaging_wallet_entries
    WHERE school_id = ${schoolId} AND reference = ${reference} AND kind <> 'TOP_UP'`;
  const reserve = entries.find((entry) => entry.kind === "RESERVE");
  if (!reserve) return "NOT_RESERVED";
  const held = BigInt(reserve.amount_kobo);
  const expectedAmount = resolution === "SETTLE" ? actualCharge ?? held : held;
  const previous = entries.find((entry) => entry.kind !== "RESERVE");
  if (previous) return previous.kind === resolution && BigInt(previous.amount_kobo) === expectedAmount
    ? "ALREADY_RESOLVED" : "CONFLICT";
  const unused = resolution === "SETTLE" ? held - expectedAmount : 0n;
  await append(db, schoolId, resolution, reference, expectedAmount, unused);
  return "RESOLVED";
}

/** Called only by the platform-admin surface after checking the provider's billing evidence. */
export function reconcileNotificationReservation(input: {
  schoolId: string; deliveryId: string; operatorId: string | null; resolution: "SETTLE" | "RELEASE"; evidenceRef: string; providerChargedKobo: bigint;
  verifiedTermiiReport?: { accountId: string; providerRef: string; contractRef: string };
}) {
  const { schoolId, deliveryId, operatorId, resolution, evidenceRef, providerChargedKobo, verifiedTermiiReport } = input;
  return inWallet(schoolId, async (db) => {
    const delivery = await db.notificationDelivery.findFirst({
      where: {
        schoolId, id: deliveryId, channel: "SMS", dispatchState: { in: ["UNKNOWN", "ACCEPTED"] },
        ...(verifiedTermiiReport && { providerAccountId: verifiedTermiiReport.accountId, providerRef: verifiedTermiiReport.providerRef }),
      },
      select: { id: true },
    });
    if (!delivery) throw new NotFoundError("Reconcilable SMS delivery not found.");
    const reference = `notification:${deliveryId}`;
    const reserve = await db.messagingWalletEntry.findFirst({
      where: { schoolId, reference, kind: "RESERVE" }, select: { amountKobo: true },
    });
    if (!reserve) throw new ConflictError("MESSAGING_RESERVATION_UNAVAILABLE", "The delivery has no reservation available for this decision.");
    const held = BigInt(reserve.amountKobo);
    const recordDiscrepancy = async () => {
      if (verifiedTermiiReport && await db.auditLog.findFirst({
        where: {
          schoolId, entityId: deliveryId, action: "messaging.wallet.discrepancy",
          metadata: { path: ["evidenceRef"], equals: evidenceRef },
        },
        select: { id: true },
      })) return;
      await db.auditLog.create({ data: {
        schoolId, userId: operatorId, action: "messaging.wallet.discrepancy", entityType: "notification_delivery",
        entityId: deliveryId, metadata: {
          evidenceRef, providerChargedKobo: String(providerChargedKobo), reservationKobo: String(held),
          ...(verifiedTermiiReport && { contractRef: verifiedTermiiReport.contractRef, source: "TERMII_WEBHOOK" }),
        },
      } });
    };
    const discrepancy = resolution === "SETTLE"
      ? providerChargedKobo <= 0n || providerChargedKobo > held
      : providerChargedKobo !== 0n;
    if (discrepancy) {
      await recordDiscrepancy();
      return { status: "DISCREPANCY" as const };
    }
    const status = await appendResolution(db, schoolId, reference, resolution, providerChargedKobo);
    if (status === "CONFLICT" && verifiedTermiiReport) {
      await recordDiscrepancy();
      return { status: "DISCREPANCY" as const };
    }
    if (status === "CONFLICT" || status === "NOT_RESERVED") {
      throw new ConflictError("MESSAGING_RESERVATION_UNAVAILABLE", "The delivery has no reservation available for this decision.");
    }
    if (status === "RESOLVED") await db.auditLog.create({ data: {
      schoolId, userId: operatorId, action: "messaging.wallet.reconcile", entityType: "notification_delivery",
      entityId: deliveryId, metadata: {
        resolution, evidenceRef, providerChargedKobo: String(providerChargedKobo),
        ...(verifiedTermiiReport && { contractRef: verifiedTermiiReport.contractRef, source: "TERMII_WEBHOOK" }),
      },
    } });
    return { status };
  }).then((result) => {
    if (!verifiedTermiiReport && result.status === "DISCREPANCY") {
      throw new ConflictError("MESSAGING_CHARGE_MISMATCH", "Provider billing differs from the expected reservation decision.");
    }
    return result;
  });
}

/** School-scoped operational report. A carrier event never substitutes for billing evidence. */
export function getMessagingReconciliation(schoolId: string): Promise<MessagingReconciliationReport> {
  return withTenant(schoolId, async (db) => {
    const rows = await db.$queryRaw<{
      delivery_id: string; reserved: number; charged: number | null; released: number | null;
      resolution: "SETTLE" | "RELEASE" | null; discrepancy: boolean; created_at: Date;
    }[]>`
      SELECT d.id AS delivery_id, held.amount_kobo AS reserved,
        CASE r.kind WHEN 'SETTLE' THEN r.amount_kobo WHEN 'RELEASE' THEN 0 END AS charged,
        CASE r.kind WHEN 'SETTLE' THEN r.released_kobo WHEN 'RELEASE' THEN r.amount_kobo END AS released,
        r.kind AS resolution, held.created_at,
        EXISTS (SELECT 1 FROM audit_logs a WHERE a.school_id = ${schoolId}
          AND a.entity_id = d.id AND a.action = 'messaging.wallet.discrepancy') AS discrepancy
      FROM messaging_wallet_entries held
      JOIN notification_deliveries d ON d.school_id = held.school_id AND held.reference = 'notification:' || d.id
      LEFT JOIN messaging_wallet_entries r ON r.school_id = held.school_id AND r.reference = held.reference
        AND r.kind IN ('SETTLE', 'RELEASE')
      WHERE held.school_id = ${schoolId} AND held.kind = 'RESERVE' AND d.channel = 'SMS'
      ORDER BY (r.kind IS NOT NULL), held.created_at DESC, held.id DESC LIMIT 101`;
    return {
      items: rows.slice(0, 100).map((row) => ({
        deliveryId: row.delivery_id, reservedKobo: String(row.reserved) as Kobo,
        chargedKobo: row.charged === null ? null : String(row.charged) as Kobo,
        releasedKobo: row.released === null ? null : String(row.released) as Kobo,
        status: row.resolution === "SETTLE" ? "SETTLED" : row.resolution === "RELEASE" ? "RELEASED"
          : row.discrepancy ? "DISCREPANCY" : "PENDING_EVIDENCE",
        discrepancyRecorded: row.discrepancy, reservedAt: row.created_at.toISOString(),
      })),
      truncated: rows.length > 100,
    };
  });
}
