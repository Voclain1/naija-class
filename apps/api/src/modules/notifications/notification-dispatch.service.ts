import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";

import { withTenant } from "@school-kit/db";

import { EXPO_BATCH_SIZE } from "../../common/push/expo-push.service";
import { PUSH_JOB_SEND, PUSH_QUEUE } from "../../common/queue";
import { NotificationPreferencesService } from "./notification-preferences.service";
import type { PushSendJobData } from "./push.jobs";

// Phase 6 / Slice 5 (D36, D37, D38) — the one place that decides HOW a
// person is reached.
//
// This service exists so that "push, or SMS, but never both" is a property
// of the system rather than a rule each call site remembers. Callers say WHO
// and WHAT; they do not choose a channel.
//
// Channel toggles come from NotificationPreferencesService.getEnabledChannels
// rather than a second read of notification_preferences here, so DEFAULTS
// stays the single source of what an unconfigured school gets.

/**
 * What a caller asks to be delivered.
 *
 * D36 IS ENFORCED BY THIS SHAPE, not by a code-review note. There is no
 * field here for a student name, a grade, an amount or a due date, because a
 * push notification renders on a LOCKED screen visible to anyone holding the
 * phone, and these are children's records. `title` is the school name and
 * `body` says what happened, never what it was.
 *
 * `smsBody` is separate and MAY be specific: an SMS is addressed to one
 * phone number and is the channel a parent already receives fee figures on
 * today. Two fields is what stops a lockscreen-safe body being quietly
 * reused as an SMS that says less than it should, or an SMS body leaking
 * onto a lockscreen.
 */
export interface NotificationRequest {
  schoolId: string;
  guardianId: string;
  /** The school's name. Public, and the only identifying thing on screen. */
  title: string;
  /** Lockscreen-safe. What happened, never what it was. */
  body: string;
  /** Opaque routing hint. Never names, grades or amounts. */
  data?: Record<string, string>;
  /** Whether the caller has an SMS it could send instead. */
  smsAvailable: boolean;
}

export type DeliveryChannel = "PUSH" | "SMS" | "NONE";

@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    @InjectQueue(PUSH_QUEUE) private readonly pushQueue: Queue,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  /**
   * Decide the channel for one guardian, and start push delivery if push is
   * the answer.
   *
   * Order, and the reason for it (D37): push is free and SMS costs money per
   * message, so push wins whenever it is actually available. "Available"
   * means the SCHOOL has push on AND we hold at least one token believed
   * live. The second half is what the receipt job (D39) maintains — without
   * it an uninstalled app looks identical to a working one, and this method
   * would confidently pick a channel reaching nobody while ALSO suppressing
   * the SMS that would have arrived.
   *
   * Returns the channel chosen. It does NOT send the SMS: that keeps this
   * service free of a Termii dependency and leaves the existing, already
   * tested SMS call sites as the only place SMS is sent. This method
   * decides; the caller sends. Callers must treat "SMS" as an instruction,
   * which is what makes the exclusivity assertable in a test.
   */
  async notifyGuardian(req: NotificationRequest): Promise<DeliveryChannel> {
    const channels = await this.preferences.getEnabledChannels(req.schoolId);

    const tokens = channels.push ? await this.liveTokensForGuardian(req) : [];

    if (channels.push && tokens.length > 0) {
      await this.enqueuePush(req, tokens);
      return "PUSH";
    }

    if (channels.sms && req.smsAvailable) {
      return "SMS";
    }

    // Neither channel available. Said out loud rather than returned quietly,
    // because "the parent was never told" is the actual outcome and it is
    // otherwise invisible.
    this.logger.warn(
      `No delivery channel for a guardian in school ${req.schoolId} ` +
        `(push=${channels.push}, tokens=${tokens.length}, sms=${channels.sms}, smsAvailable=${req.smsAvailable})`,
    );
    return "NONE";
  }

  /** Tokens currently believed reachable for this guardian. */
  private async liveTokensForGuardian(req: NotificationRequest): Promise<string[]> {
    return withTenant(req.schoolId, async (db) => {
      const rows = await db.deviceToken.findMany({
        where: { guardianId: req.guardianId },
        select: { expoPushToken: true },
      });
      return rows.map((r) => r.expoPushToken);
    });
  }

  /**
   * Split into Expo-sized batches and enqueue one job each (D38).
   *
   * One person's own devices rarely exceed a handful, so this usually
   * produces a single job. The batching is here because the same path is
   * what a future school-wide fan-out reuses, and a batch limit discovered
   * at 400 recipients is a limit discovered in production.
   */
  private async enqueuePush(req: NotificationRequest, tokens: string[]): Promise<void> {
    for (let i = 0; i < tokens.length; i += EXPO_BATCH_SIZE) {
      const data: PushSendJobData = {
        schoolId: req.schoolId,
        tokens: tokens.slice(i, i + EXPO_BATCH_SIZE),
        title: req.title,
        body: req.body,
        ...(req.data ? { payload: req.data } : {}),
      };
      await this.pushQueue.add(PUSH_JOB_SEND, data, {
        // Deliberately fewer retries than a money path would get: nothing
        // here is a mutation, a notification that failed twice is stale by
        // the third attempt, and a missed one is recoverable by opening the
        // app.
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: true,
      });
    }
  }
}
