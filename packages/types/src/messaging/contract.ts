export type Kobo = `${bigint}`;
export type MessagingChannel = "EMAIL" | "PUSH" | "SMS" | "WHATSAPP";
export type MessagingBlocker =
  | "CHANNEL_DISABLED" | "PROVIDER_UNAVAILABLE" | "PRICE_MISSING" | "EMERGENCY_STOP"
  | "INSUFFICIENT_CREDIT" | "SPENDING_LIMIT" | "TEMPLATE_NOT_APPROVED"
  | "ONBOARDING_DISABLED" | "SHARED_SENDER_NOT_AUTHORIZED"
  | "PROVIDER_DISABLED" | "RECIPIENT_UNVERIFIED" | "CONSENT_MISSING" | "OPTED_OUT";

export type DeliveryState =
  | "QUEUED" | "SENDING" | "ACCEPTED" | "SENT" | "DELIVERED" | "READ"
  | "FAILED" | "UNKNOWN" | "CANCELLED" | "DEAD_LETTER" | "BLOCKED";

export interface MessagingOverview {
  providers: Array<{
    channel: MessagingChannel;
    ready: boolean;
    blockers: MessagingBlocker[];
  }>;
  preferences: Record<MessagingChannel, boolean>;
  paidPreferences?: MessagingPaidPreferences;
  wallet: { availableKobo: Kobo; reservedKobo: Kobo; lowBalance: boolean | null };
  whatsapp: {
    status: "DISCONNECTED" | "PENDING" | "CONNECTED" | "UNHEALTHY";
    billing: "SCHOOLKIT" | "SCHOOL_OWNED" | null;
  };
  templates: Array<{
    name: string;
    language: string | null;
    approval: "UNKNOWN" | "PENDING" | "APPROVED" | "REJECTED" | "PAUSED";
  }>;
}

export interface MessagingDelivery {
  id: string;
  channel: MessagingChannel;
  state: DeliveryState;
  createdAt: string;
  updatedAt: string;
  blocker: MessagingBlocker | null;
  reasonCode?: string;
  rateVersion?: string;
  estimatedKobo?: Kobo;
}

export interface MessagingWalletEntry {
  id: string;
  kind: "TOP_UP" | "RESERVE" | "SETTLE" | "RELEASE";
  amountKobo: Kobo;
  releasedKobo?: Kobo;
  createdAt: string;
}

export interface MessagingReminderEstimate {
  recipientCount: number;
  excluded: Array<{ reason: string; count: number }>;
  channels: Array<{ channel: MessagingChannel; count: number; estimatedKobo: Kobo | null }>;
  totalEstimatedKobo: Kobo | null;
}

export interface MessagingPlatformControls {
  providerActivation?: Record<MessagingEmergencyChannel, MessagingProviderActivationState>;
  platformSpendLimit?: MessagingSpendLimitState;
  emergency?: Record<MessagingEmergencyChannel, MessagingEmergencyState>;
  paidSendingEnabled: boolean;
  embeddedSignupEnabled: boolean;
  dailyLimitKobo: Kobo;
  prices: Array<{
    schoolId: string;
    key: "TERMII_SMS" | "META_UTILITY" | "META_MARKETING" | "META_AUTHENTICATION";
    version: string;
    effectiveFrom: string;
    effectiveUntil: string;
    verifiedAt: string;
    unitPriceKobo: Kobo;
    effective: boolean;
  }>;
}

export interface MessagingWalletPage {
  items: MessagingWalletEntry[];
  nextCursor: string | null;
}

export interface MessagingTopUpRequest {
  clientRequestId: string;
  amountKobo: Kobo;
}

export interface MessagingTopUpCheckout {
  reference: string;
  checkoutUrl: string;
}

export interface MessagingMetaSignupSession {
  appId: string;
  configId: string;
  graphVersion: string;
  state: string;
  expiresAt: string;
}

export interface MessagingMetaSignupCompletion {
  code: string;
  state: string;
  wabaId: string;
  phoneNumberId: string;
}

export interface MessagingMetaDisconnectResult {
  status: "DISCONNECTED";
  revocationPending: boolean;
}

export interface MessagingDeliveryPage {
  items: MessagingDelivery[];
  nextCursor: string | null;
}

export interface MessagingPaidPreferences {
  paidWhatsAppEnabled: boolean;
  walletSmsEnabled: boolean;
}

export interface MessagingReconciliationReport {
  items: Array<{
    deliveryId: string;
    reservedKobo: Kobo;
    chargedKobo: Kobo | null;
    releasedKobo: Kobo | null;
    status: "PENDING_EVIDENCE" | "DISCREPANCY" | "SETTLED" | "RELEASED";
    discrepancyRecorded: boolean;
    reservedAt: string;
  }>;
  truncated: boolean;
}

export type MessagingEmergencyChannel = "SMS" | "WHATSAPP";

export interface MessagingEmergencyState {
  stopped: boolean;
  revision: string | null;
}

export interface MessagingEmergencyWrite {
  stopped: boolean;
  evidenceRef: string;
}

export interface MessagingMetaRegistrationRequest {
  registrationSecret: string;
}

export interface MessagingMetaTemplateSubmission {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  body: string;
  bodyExamples: string[];
  paymentButtonText?: string;
}

export interface MessagingInboundHistory {
  items: Array<{ id: string; occurredAt: string; text: string }>;
  truncated: boolean;
}

export interface MessagingSpendLimitState {
  dailyKobo: Kobo | null;
  revision: string | null;
}

export interface MessagingSpendLimitWrite {
  dailyKobo: Kobo | null;
  evidenceRef: string;
}

export interface MessagingRateReviewWrite {
  evidenceRef: string;
  rates: Array<{
    key: "TERMII_SMS" | "META_UTILITY" | "META_MARKETING" | "META_AUTHENTICATION";
    version: string;
    evidence: string;
    effectiveFrom: string;
    effectiveUntil: string;
    verifiedAt: string;
    providerAmount: string;
    rateNumerator: string;
    rateDenominator: string;
    taxBasisPoints: string;
    marginBasisPoints: string;
  }>;
}

export interface MessagingTemplateReviewWrite {
  evidenceRef: string;
  review: null | {
    wabaId: string;
    providerTemplateId: string;
    approvedBody: string;
    language: string;
    category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
    bodyFields: Array<"schoolName" | "amountPaid" | "balanceLeft" | "studentName" | "absenceDate" | "termName" | "examTitle" | "examStart" | "dueDate" | "parentPortalUrl">;
    paymentButtonIndex?: number;
  };
}

export interface MessagingReviewRevision {
  revision: string;
}

export interface MessagingProviderActivationState {
  enabled: boolean | null;
  revision: string | null;
}

export interface MessagingProviderActivationWrite {
  enabled: boolean;
  evidenceRef: string;
}

export interface MessagingRateCatalogState {
  revision: string | null;
  rates: MessagingRateReviewWrite["rates"] | null;
}
