export type Kobo = `${bigint}`;
export type MessagingChannel = "EMAIL" | "PUSH" | "SMS" | "WHATSAPP";
export type MessagingBlocker =
  | "CHANNEL_DISABLED" | "PROVIDER_UNAVAILABLE" | "PRICE_MISSING"
  | "INSUFFICIENT_CREDIT" | "SPENDING_LIMIT" | "TEMPLATE_NOT_APPROVED"
  | "ONBOARDING_DISABLED" | "SHARED_SENDER_NOT_AUTHORIZED"
  | "RECIPIENT_UNVERIFIED" | "CONSENT_MISSING" | "OPTED_OUT";

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
  createdAt: string;
}

export interface MessagingReminderEstimate {
  recipientCount: number;
  excluded: Array<{ reason: string; count: number }>;
  channels: Array<{ channel: MessagingChannel; count: number; estimatedKobo: Kobo | null }>;
  totalEstimatedKobo: Kobo | null;
}

export interface MessagingPlatformControls {
  paidSendingEnabled: boolean;
  embeddedSignupEnabled: boolean;
  dailyLimitKobo: Kobo;
  prices: Array<{ channel: "SMS" | "WHATSAPP"; unitPriceKobo: Kobo }>;
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
