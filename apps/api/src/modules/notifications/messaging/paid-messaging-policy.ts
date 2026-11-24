import type { Kobo, MessagingPlatformControls } from "@school-kit/types";
import { z } from "zod";

import { quoteMessagingKobo, resolveMessagingRate, type VerifiedMessagingRate } from "./messaging-pricing";
import type { VerifiedMetaTemplate } from "./meta-provider";

const amount = z.string().regex(/^[1-9]\d{0,9}$/).transform((value) => BigInt(value)).refine((value) => value <= 2_147_483_647n);
const basisPoints = z.string().regex(/^\d{1,6}$/).transform((value) => BigInt(value));
const date = z.string().datetime({ offset: true }).transform((value) => new Date(value));

const rateSchema: z.ZodType<VerifiedMessagingRate, z.ZodTypeDef, unknown> = z.object({
  key: z.enum(["TERMII_SMS", "META_UTILITY", "META_MARKETING", "META_AUTHENTICATION"]),
  version: z.string().trim().min(1).max(100),
  evidence: z.string().trim().min(1).max(300),
  effectiveFrom: date,
  effectiveUntil: date,
  verifiedAt: date,
  providerAmount: amount,
  rateNumerator: amount,
  rateDenominator: amount,
  taxBasisPoints: basisPoints,
  marginBasisPoints: basisPoints,
}).strict();

export function readVerifiedMessagingRates(raw: string | undefined): VerifiedMessagingRate[] {
  if (!raw) return [];
  try {
    const result = z.array(rateSchema).max(100).safeParse(JSON.parse(raw));
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

const templateSchema = z.object({
  name: z.enum(["fee_payment_confirmation", "fee_invoice_issued", "fee_payment_reminder", "fee_payment_overdue", "student_absence_alert", "results_released", "examination_notification", "guardian_invitation"]),
  wabaId: z.string().regex(/^\d{1,32}$/),
  providerTemplateId: z.string().regex(/^\d{1,32}$/),
  approvedBody: z.string().min(1).max(1024),
  language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
  category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]),
  approval: z.literal("APPROVED"),
  bodyFields: z.array(z.enum([
    "schoolName", "amountPaid", "balanceLeft", "studentName", "absenceDate", "termName", "examTitle", "examStart", "dueDate", "parentPortalUrl",
  ])).max(20),
  paymentButtonIndex: z.number().int().nonnegative().max(9).optional(),
  reviewedBy: z.string().trim().min(1).max(120),
  reviewEvidence: z.string().trim().min(1).max(300),
  reviewedAt: date,
}).strict();

const profiles = z.array(z.object({
  schoolId: z.string().uuid(),
  schoolDailyKobo: amount,
  lowBalanceKobo: amount.optional(),
  rates: z.array(rateSchema).max(100),
  channel: z.enum(["WHATSAPP", "SMS"]),
  template: templateSchema.optional(),
  eventTemplates: z.array(templateSchema).max(10).optional(),
  termiiAccountId: z.string().regex(/^[a-z0-9_-]{8,64}$/).optional(),
}).strict()).max(100);

export type PaidMessagingProfile = z.infer<typeof profiles>[number];

export function readPaidMessagingProfiles(enabled: string | undefined, raw: string | undefined): PaidMessagingProfile[] {
  if (enabled !== "on" || !raw) return [];
  try {
    const result = profiles.safeParse(JSON.parse(raw));
    if (!result.success || new Set(result.data.map(({ schoolId }) => schoolId)).size !== result.data.length) return [];
    return result.data;
  } catch {
    return [];
  }
}

export function reviewedEventTemplate(
  profile: PaidMessagingProfile,
  name: VerifiedMetaTemplate["name"],
  at: Date,
): VerifiedMetaTemplate | undefined {
  const templates = [...(profile.template ? [profile.template] : []), ...(profile.eventTemplates ?? [])];
  const current = templates.filter((template) => template.name === name && template.reviewedAt <= at);
  return current.length === 1 ? current[0] : undefined;
}

export function parsePaidPlatformLimit(configured: string | undefined): bigint {
  return configured && /^[1-9]\d{0,9}$/.test(configured) && BigInt(configured) <= 2_147_483_647n ? BigInt(configured) : 0n;
}

export function messagingPlatformControls(env: Readonly<NodeJS.ProcessEnv>, now = new Date()): MessagingPlatformControls {
  const staged = readPaidMessagingProfiles("on", env.MESSAGING_PAID_PAYMENT_PROFILES);
  return {
    paidSendingEnabled: env.MESSAGING_PAID_ENABLED === "on",
    embeddedSignupEnabled: env.MESSAGING_META_SIGNUP_ENABLED === "on",
    dailyLimitKobo: String(parsePaidPlatformLimit(env.MESSAGING_PAID_PLATFORM_DAILY_KOBO)) as Kobo,
    prices: staged.flatMap(({ schoolId, rates }) => rates.map((rate) => ({
      schoolId, key: rate.key, version: rate.version, unitPriceKobo: String(quoteMessagingKobo(rate, 1)) as Kobo,
      effectiveFrom: rate.effectiveFrom.toISOString(), effectiveUntil: rate.effectiveUntil.toISOString(),
      verifiedAt: rate.verifiedAt.toISOString(), effective: resolveMessagingRate(rates, rate.key, now) === rate,
    }))),
  };
}
