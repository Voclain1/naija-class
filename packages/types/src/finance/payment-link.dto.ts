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
      requestCode: string;
      createdAt: string;
    };
