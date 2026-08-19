import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, Queue } from "bullmq";

import { withTenant } from "@school-kit/db";

import {
  DEVICE_NOT_REGISTERED,
  ExpoPushService,
  type ExpoPushMessage,
} from "../../common/push/expo-push.service";
import { PUSH_JOB_RECEIPTS, PUSH_JOB_SEND, PUSH_QUEUE } from "../../common/queue";
import type { PushReceiptsJobData, PushSendJobData } from "./push.jobs";

// PushProcessor — the sole BullMQ entry for PUSH_QUEUE.
//
// ONE @Processor class, dispatching on job.name. @nestjs/bullmq spawns one
// Worker per @Processor class, so a second class on this queue would
// load-balance jobs across competing workers and a `receipts` job would land
// on the wrong one about half the time. Same pattern, and the same reason,
// as ImportsProcessor.

// How long to wait before asking Expo whether a batch actually arrived.
//
// Expo receipts are not ready immediately — a ticket only says "accepted for
// delivery". Five minutes is long enough that most receipts exist, and far
// short of the ~24h Expo keeps them, so a re-poll has room.
const RECEIPT_DELAY_MS = 5 * 60 * 1000;

@Processor(PUSH_QUEUE)
export class PushProcessor extends WorkerHost {
  private readonly logger = new Logger(PushProcessor.name);

  constructor(
    private readonly expo: ExpoPushService,
    @InjectQueue(PUSH_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  // NOT wrapped in tenantWorker, deliberately. That helper requires a
  // `userId` on the job data and opens a tenant-scoped connection for the
  // handler. Neither fits here: these jobs are SYSTEM-originated — no human
  // acts, so any userId would be invented — and the send path touches no
  // database at all, so opening a tenant connection for it would be pure
  // waste on the hot path. The one place that does write (pruneTokens) opens
  // its own withTenant, which is where the tenant scoping actually belongs.
  //
  // The schoolId guard tenantWorker would have provided is kept explicitly
  // below, because it is the part that genuinely matters: a job with no
  // school cannot be scoped and must not be silently processed.
  async process(job: Job): Promise<void> {
    const schoolId: unknown = (job.data as { schoolId?: unknown } | undefined)?.schoolId;
    if (typeof schoolId !== "string" || schoolId.length === 0) {
      throw new Error(
        `PushProcessor: job ${job.id ?? "(no id)"} on '${PUSH_QUEUE}' has no schoolId; refusing to process it.`,
      );
    }

    switch (job.name) {
      case PUSH_JOB_SEND:
        return this.handleSend(job.data as PushSendJobData);
      case PUSH_JOB_RECEIPTS:
        return this.handleReceipts(job.data as PushReceiptsJobData);
      default:
        throw new Error(`PushProcessor received unknown job name '${job.name}'`);
    }
  }

  /**
   * Send one batch, then schedule the receipt poll for it.
   *
   * Tickets come back POSITIONALLY — Expo returns one ticket per message in
   * input order — which is the only way to know which token a ticket belongs
   * to. An error ticket carrying DeviceNotRegistered is acted on
   * immediately; everything else waits for a receipt, because an "ok" ticket
   * is an acceptance, not a delivery.
   */
  private async handleSend(data: PushSendJobData): Promise<void> {
    const messages: ExpoPushMessage[] = data.tokens.map((to) => ({
      to,
      title: data.title,
      body: data.body,
      ...(data.payload ? { data: data.payload } : {}),
    }));

    const tickets = await this.expo.send(messages);

    const outstanding: Record<string, string> = {};
    const deadTokens: string[] = [];

    tickets.forEach((ticket, i) => {
      const token = data.tokens[i];
      if (!token) return;

      if (ticket.status === "ok" && ticket.id) {
        outstanding[ticket.id] = token;
        return;
      }
      if (ticket.details?.error === DEVICE_NOT_REGISTERED) {
        deadTokens.push(token);
        return;
      }
      // Any other error ticket is logged and dropped. It is deliberately NOT
      // treated as a dead token: a transient Expo-side error must not delete
      // a working device, because the token cannot be recovered until the
      // app happens to re-register.
      this.logger.warn(
        `Push ticket error for school ${data.schoolId}: ` +
          `${ticket.details?.error ?? ticket.message ?? "unknown"}`,
      );
    });

    if (deadTokens.length > 0) {
      await this.pruneTokens(data.schoolId, deadTokens);
    }

    if (Object.keys(outstanding).length > 0) {
      await this.queue.add(
        PUSH_JOB_RECEIPTS,
        { schoolId: data.schoolId, tickets: outstanding } satisfies PushReceiptsJobData,
        {
          delay: RECEIPT_DELAY_MS,
          attempts: 3,
          backoff: { type: "exponential", delay: 60_000 },
          removeOnComplete: true,
        },
      );
    }
  }

  /**
   * Poll receipts and prune whatever Expo says is gone (D39).
   *
   * An id ABSENT from the response means the receipt is not ready yet, never
   * that delivery succeeded. Absent ids are re-enqueued rather than assumed
   * good — treating absence as success is precisely how dead tokens survive,
   * and a surviving dead token silently suppresses the SMS fallback that
   * would have reached the parent.
   */
  private async handleReceipts(data: PushReceiptsJobData): Promise<void> {
    const ids = Object.keys(data.tickets);
    const receipts = await this.expo.getReceipts(ids);

    const deadTokens: string[] = [];
    const stillPending: Record<string, string> = {};

    for (const id of ids) {
      const token = data.tickets[id];
      if (!token) continue;

      const receipt = receipts[id];
      if (!receipt) {
        stillPending[id] = token;
        continue;
      }
      if (receipt.status === "error" && receipt.details?.error === DEVICE_NOT_REGISTERED) {
        deadTokens.push(token);
        continue;
      }
      if (receipt.status === "error") {
        this.logger.warn(
          `Push receipt error for school ${data.schoolId}: ` +
            `${receipt.details?.error ?? receipt.message ?? "unknown"}`,
        );
      }
    }

    if (deadTokens.length > 0) {
      await this.pruneTokens(data.schoolId, deadTokens);
    }

    // Re-poll only the undecided remainder. BullMQ's own `attempts` cannot
    // express this, because the job did not fail — it partially succeeded,
    // and retrying the whole batch would re-ask about receipts already read.
    if (Object.keys(stillPending).length > 0) {
      await this.queue.add(
        PUSH_JOB_RECEIPTS,
        { schoolId: data.schoolId, tickets: stillPending } satisfies PushReceiptsJobData,
        { delay: RECEIPT_DELAY_MS, attempts: 2, removeOnComplete: true },
      );
    }
  }

  /**
   * Delete tokens Expo has told us are gone (D39, D40).
   *
   * Scoped by withTenant like every other write, so a prune can only ever
   * touch the school whose own batch produced the receipt.
   */
  private async pruneTokens(schoolId: string, tokens: string[]): Promise<void> {
    const { count } = await withTenant(schoolId, (db) =>
      db.deviceToken.deleteMany({ where: { expoPushToken: { in: tokens } } }),
    );
    this.logger.log(
      `Pruned ${count} unregistered device token(s) for school ${schoolId}; ` +
        `those recipients now fall back to SMS.`,
    );
  }
}
