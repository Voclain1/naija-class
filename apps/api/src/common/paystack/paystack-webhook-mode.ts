import type { ConfigService } from "@nestjs/config";

export function paystackWebhookMode(config: ConfigService): "live" | "test" | "legacy" {
  const configured = config.get<string>("PAYSTACK_WEBHOOK_MODE");
  const key = config.get<string>("PAYSTACK_SECRET_KEY");
  const keyMode = key?.startsWith("sk_live_") ? "live" : key?.startsWith("sk_test_") ? "test" : null;
  if (configured) {
    if ((configured === "live" || configured === "test") && (!key || configured === keyMode)) return configured;
    return "legacy";
  }
  return keyMode ?? "legacy";
}
