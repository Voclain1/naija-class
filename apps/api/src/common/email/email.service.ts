import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

import { InternalError } from "@school-kit/types";

import { Sentry } from "../../observability/sentry";
import { redactEmail } from "../redact.js";

// ---------------------------------------------------------------------------
// Resend wrapper — Phase 4 / Slice 6. Extracted from FinanceService, which
// previously held its own `this.resend` field initialized straight from
// process.env (finance.service.ts, Phase 3 Slice 10). Centralising it here
// means guardian-invite email (this slice) and fee reminders (extended by
// this slice, see finance.service.ts) share one Resend client and one
// tested send path, per docs/modules/phase-4.md §8 D5.
//
// Lazy-checked per call (mirrors PaystackService/TermiiService), not at
// boot — the app still starts with RESEND_API_KEY absent, callers get
// `{sent:0, skipped:N}`-style degraded behavior instead of a crash.
// ---------------------------------------------------------------------------

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: Resend | null;

  constructor(private readonly config: ConfigService) {
    const key = config.get<string>("RESEND_API_KEY");
    if (!key) {
      this.logger.warn("RESEND_API_KEY is not set — emails will not be sent");
    }
    this.client = key ? new Resend(key) : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * `purpose` names the email for operators (e.g. "staff-password-reset"); it
   * travels to Sentry as a tag, since the subject can carry a child's name.
   */
  async send(params: { to: string; subject: string; html: string; purpose?: string }): Promise<void> {
    if (!this.client) {
      throw new InternalError("RESEND_API_KEY is not configured on this server");
    }

    // Resend's SDK returns { data, error } — it does NOT throw on an
    // API-level failure (an invalid `to`, a suspended domain, etc.), only on
    // a network-level failure. Both must be checked; FinanceService's
    // pre-extraction code only had the try/catch, which meant an API-level
    // `error` was silently swallowed as a "successful" send.
    //
    // Every failure also goes to Sentry (2026-10-08). Several callers must
    // answer the same whatever happens (forgot-password cannot reveal whether
    // an address exists), so they catch this and only log; before this, a
    // dead mail provider showed up nowhere an operator looks.
    let failure: string | null = null;
    try {
      const { error } = await this.client.emails.send({
        from: "no-reply@schoolkit.ng",
        to: params.to,
        subject: params.subject,
        html: params.html,
      });
      if (error) failure = error.message;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }

    if (failure !== null) {
      this.logger.error(`Resend send to ${redactEmail(params.to)} failed: ${failure}`);
      Sentry.captureMessage("Email send failed", {
        level: "error",
        tags: { component: "email", purpose: params.purpose ?? "unspecified" },
        extra: { to: redactEmail(params.to), reason: failure },
      });
      throw new InternalError(`Email send failed: ${failure}`);
    }
  }
}
