import { basePrisma, type PrismaClient, withTenant } from "@school-kit/db";
import { NotFoundError, ValidationError, type Kobo, type MessagingSpendLimitState, type MessagingSpendLimitWrite } from "@school-kit/types";

export async function messagingSpendLimit(scope: string, db: PrismaClient = basePrisma): Promise<MessagingSpendLimitState> {
  const entry = await db.messagingSpendLimitRevision.findFirst({
    where: { scope }, select: { dailyKobo: true, revision: true }, orderBy: { revision: "desc" },
  });
  return {
    dailyKobo: entry?.dailyKobo == null ? null : String(entry.dailyKobo) as Kobo,
    revision: entry?.revision.toString() ?? null,
  };
}

/** The VPS limit is a ceiling. A database amendment can tighten it or restore the original ceiling. */
export async function effectiveMessagingSpendLimit(scope: string, configuredKobo: bigint, db?: PrismaClient): Promise<bigint> {
  const { dailyKobo } = await messagingSpendLimit(scope, db);
  const cap = dailyKobo === null ? configuredKobo : BigInt(dailyKobo);
  return cap < configuredKobo ? cap : configuredKobo;
}

export async function writeMessagingSpendLimit(
  scope: string, actorId: string, input: MessagingSpendLimitWrite,
): Promise<MessagingSpendLimitState> {
  const limit = input.dailyKobo === null ? null : BigInt(input.dailyKobo);
  if (limit !== null && (limit < 0n || limit > 2_147_483_647n)) throw new ValidationError("Invalid spending limit.");
  const write = async (db: PrismaClient) => {
    if (scope !== "platform" && !(await db.school.findUnique({ where: { id: scope }, select: { id: true } }))) {
      throw new NotFoundError("School not found.");
    }
    const row = await db.messagingSpendLimitRevision.create({
      data: { scope, actorId, dailyKobo: limit === null ? null : Number(limit), evidenceRef: input.evidenceRef },
      select: { revision: true },
    });
    return { dailyKobo: input.dailyKobo, revision: row.revision.toString() };
  };
  return scope === "platform" ? write(basePrisma) : withTenant(scope, write);
}
