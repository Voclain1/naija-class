import { z } from "zod";

import { basePrisma, Prisma, type PrismaClient, withTenant } from "@school-kit/db";
import { NotFoundError, ValidationError, type MessagingRateReviewWrite, type MessagingEmergencyChannel, type MessagingProviderActivationState, type MessagingProviderActivationWrite, type MessagingRateCatalogState, type MessagingReviewRevision, type MessagingTemplateReviewWrite } from "@school-kit/types";

import type { VerifiedMessagingRate } from "./messaging-pricing";
import { META_TEMPLATE_NAMES, type VerifiedMetaTemplate } from "./meta-provider";
import { paidRateCatalogSchema, paidTemplateReviewSchema } from "./paid-messaging-policy";

function latest(db: PrismaClient, scope: string, reviewKey: string) {
  return db.messagingReviewRevision.findFirst({
    where: { scope, reviewKey }, orderBy: { revision: "desc" }, select: { snapshot: true, revision: true },
  });
}

export async function messagingProviderActivation(channel: MessagingEmergencyChannel): Promise<MessagingProviderActivationState> {
  const row = await latest(basePrisma, "platform", `provider:${channel}`);
  return {
    enabled: row ? row.snapshot === true : null, revision: row?.revision.toString() ?? null,
  };
}

export async function writeMessagingProviderActivation(
  channel: MessagingEmergencyChannel, actorId: string, input: MessagingProviderActivationWrite,
): Promise<MessagingProviderActivationState> {
  const result = await basePrisma.messagingReviewRevision.create({
    data: {
      scope: "platform", reviewKey: `provider:${channel}`, actorId,
      evidenceRef: input.evidenceRef, snapshot: input.enabled,
    },
    select: { revision: true },
  });
  return { enabled: input.enabled, revision: result.revision.toString() };
}

export async function messagingRateCatalogState(scope: string): Promise<MessagingRateCatalogState> {
  const row = await latest(basePrisma, scope, "price-catalog");
  const parsed = z.array(z.record(z.string())).safeParse(row?.snapshot);
  return {
    revision: row?.revision.toString() ?? null,
    rates: parsed.success ? parsed.data as MessagingRateReviewWrite["rates"] : null,
  };
}

export async function reviewedMessagingRates(
  scope: string, fallback: readonly VerifiedMessagingRate[], db: PrismaClient = basePrisma,
): Promise<readonly VerifiedMessagingRate[]> {
  const row = await latest(db, scope, "price-catalog");
  if (!row) return fallback;
  const parsed = paidRateCatalogSchema.safeParse(row.snapshot);
  return parsed.success ? parsed.data : [];
}

export async function reviewedMessagingTemplate(
  schoolId: string, name: VerifiedMetaTemplate["name"], fallback: VerifiedMetaTemplate | undefined, db: PrismaClient = basePrisma,
): Promise<VerifiedMetaTemplate | undefined> {
  const row = await latest(db, schoolId, `template:${name}`);
  if (!row) return fallback;
  const parsed = paidTemplateReviewSchema.safeParse(row.snapshot);
  return parsed.success ? parsed.data : undefined;
}

export async function writeMessagingRateCatalog(
  scope: string, actorId: string, input: MessagingRateReviewWrite,
): Promise<MessagingReviewRevision> {
  const catalog = paidRateCatalogSchema.safeParse(input.rates);
  if (!catalog.success) throw new ValidationError("Invalid effective-dated messaging prices.");
  const now = new Date();
  const versions = new Set<string>();
  for (const rate of catalog.data) {
    const version = `${rate.key}:${rate.version}`;
    if (rate.effectiveFrom >= rate.effectiveUntil || rate.verifiedAt > now || versions.has(version) ||
        (scope === "platform" && rate.key !== "TERMII_SMS")) throw new ValidationError("Invalid rate verification or version.");
    versions.add(version);
  }
  for (const [index, rate] of catalog.data.entries()) {
    if (catalog.data.slice(index + 1).some((other) => other.key === rate.key &&
        rate.effectiveFrom < other.effectiveUntil && other.effectiveFrom < rate.effectiveUntil)) {
      throw new ValidationError("Messaging price validity intervals overlap.");
    }
  }
  const write = async (db: PrismaClient) => {
    if (scope !== "platform" && !(await db.school.findUnique({ where: { id: scope }, select: { id: true } }))) {
      throw new NotFoundError("School not found.");
    }
    const result = await db.messagingReviewRevision.create({
      data: { scope, reviewKey: "price-catalog", actorId, evidenceRef: input.evidenceRef, snapshot: input.rates },
      select: { revision: true },
    });
    return { revision: result.revision.toString() };
  };
  return scope === "platform" ? write(basePrisma) : withTenant(scope, write);
}

export async function writeMessagingTemplateReview(
  schoolId: string, name: string, actorId: string, input: MessagingTemplateReviewWrite,
): Promise<MessagingReviewRevision> {
  if (!META_TEMPLATE_NAMES.some((known) => known === name && known !== "setup_call_booked")) {
    throw new ValidationError("Unsupported school messaging template.");
  }
  return withTenant(schoolId, async (db) => {
    if (!(await db.school.findUnique({ where: { id: schoolId }, select: { id: true } }))) throw new NotFoundError("School not found.");
    const snapshot = input.review && {
      ...input.review, name, approval: "APPROVED", reviewedBy: actorId,
      reviewEvidence: input.evidenceRef, reviewedAt: new Date().toISOString(),
    };
    if (snapshot) {
      if (!paidTemplateReviewSchema.safeParse(snapshot).success) throw new ValidationError("Invalid template review.");
      const connection = await db.messagingSchoolMetaConnection.findFirst({
        where: { schoolId, wabaId: snapshot.wabaId, disconnectedAt: null, activationPending: false },
        select: { schoolId: true },
      });
      if (!connection) throw new ValidationError("The reviewed template must belong to the connected school account.");
    }
    const result = await db.messagingReviewRevision.create({
      data: {
        scope: schoolId, reviewKey: `template:${name}`, actorId,
        evidenceRef: input.evidenceRef, snapshot: snapshot ?? Prisma.JsonNull,
      },
      select: { revision: true },
    });
    return { revision: result.revision.toString() };
  });
}
