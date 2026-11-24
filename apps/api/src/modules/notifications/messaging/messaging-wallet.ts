import { randomUUID } from "node:crypto";

import { type PrismaClient, withTenant } from "@school-kit/db";

type EntryKind = "TOP_UP" | "RESERVE" | "SETTLE" | "RELEASE";
type Entry = { kind: EntryKind; amount_kobo: number };
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
      WHEN 'RESERVE' THEN -amount_kobo ELSE 0 END), 0) AS "availableKobo",
      COALESCE(SUM(CASE kind WHEN 'RESERVE' THEN amount_kobo WHEN 'TOP_UP' THEN 0
        ELSE -amount_kobo END), 0) AS "reservedKobo"
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

async function append(db: PrismaClient, schoolId: string, kind: EntryKind, reference: string, amountKobo: bigint) {
  return db.$executeRaw`
    INSERT INTO messaging_wallet_entries (id, school_id, reference, kind, amount_kobo)
    VALUES (${randomUUID()}, ${schoolId}, ${reference}, ${kind}, ${amountKobo}::integer)
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
      SELECT kind, amount_kobo FROM messaging_wallet_entries
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
      SELECT kind, amount_kobo FROM messaging_wallet_entries
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
    if (!daily || daily.schoolReserved + amountKobo > policy.schoolDailyKobo) return "SPENDING_LIMIT";
    const consumed = await db.$executeRaw`
      INSERT INTO messaging_platform_reservations_daily (day, reserved_kobo)
      SELECT ${daily.day}::date, ${amountKobo}::bigint
      WHERE ${amountKobo}::bigint <= ${policy.platformDailyKobo}::bigint
      ON CONFLICT (day) DO UPDATE SET reserved_kobo =
        messaging_platform_reservations_daily.reserved_kobo + EXCLUDED.reserved_kobo
      WHERE messaging_platform_reservations_daily.reserved_kobo + EXCLUDED.reserved_kobo <= ${policy.platformDailyKobo}::bigint`;
    if (!consumed) return "SPENDING_LIMIT";
    await append(db, schoolId, "RESERVE", reference, amountKobo);
    return "RESERVED";
  });
}

/** Leave the reservation open while a provider outcome is uncertain. */
export function resolveMessagingCredit(schoolId: string, reference: string, resolution: "SETTLE" | "RELEASE") {
  return inWallet(schoolId, async (db) => {
    const entries = await db.$queryRaw<Entry[]>`
      SELECT kind, amount_kobo FROM messaging_wallet_entries
      WHERE school_id = ${schoolId} AND reference = ${reference} AND kind <> 'TOP_UP'`;
    const reserve = entries.find((entry) => entry.kind === "RESERVE");
    if (!reserve) return "NOT_RESERVED";
    const previous = entries.find((entry) => entry.kind !== "RESERVE");
    if (previous) return previous.kind === resolution ? "ALREADY_RESOLVED" : "CONFLICT";
    await append(db, schoolId, resolution, reference, BigInt(reserve.amount_kobo));
    return "RESOLVED";
  });
}
