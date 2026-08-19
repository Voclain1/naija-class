// Phase 6 / Slice 5 — payloads for the two PUSH_QUEUE job names.
//
// Both carry schoolId as their first field because tenantWorker requires it:
// a job with no schoolId cannot open a tenant-scoped connection, and is
// thrown rather than processed.

export interface PushSendJobData {
  schoolId: string;
  /** At most EXPO_BATCH_SIZE. Enforced by the producer, checked by Expo. */
  tokens: string[];
  title: string;
  /** Lockscreen-safe (D36). */
  body: string;
  payload?: Record<string, string>;
}

/**
 * Receipt poll (D39).
 *
 * Carries the ticket-id -> token mapping the send job produced. Held in the
 * JOB rather than in a database table on purpose: the mapping is needed
 * exactly once, minutes after the send, and Expo discards receipts after
 * roughly 24 hours anyway. A table would be a permanent structure holding
 * rows whose entire purpose expires the same day, and would need its own
 * migration, RLS policy and cleanup job to do what a delayed job payload
 * does for free.
 */
export interface PushReceiptsJobData {
  schoolId: string;
  /** ticketId -> the Expo token it was sent to. */
  tickets: Record<string, string>;
}
