export type PaymentLinkStateDto =
  | { state: "CONNECT_PAYSTACK" }
  | { state: "NOT_CREATED" }
  | { state: "CREATING" }
  | { state: "RETRYABLE_FAILURE"; failureCode: string | null }
  | {
      state: "LIVE";
      id: string;
      url: string;
      amount: number;
      currency: "NGN";
      schoolName: string;
      studentLabel: string;
      requestCode: string;
      createdAt: string;
    };

export function buildPaymentLinkMessage(input: {
  schoolName: string;
  studentLabel: string;
  amount: number;
  url: string;
}): string {
  const amount = `₦${(input.amount / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return `${input.schoolName}: ${amount} school-fee balance for ${input.studentLabel}. Pay securely: ${input.url}`;
}

export function buildNoRecipientWhatsAppUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
