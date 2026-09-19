import { Queue } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";

import { queueJobId } from "./job-id";

// Two halves, deliberately.
//
// The pure half pins the helper's contract. The REAL-REDIS half pins the thing
// the helper exists for: that BullMQ rejects the ids this codebase was
// actually building. A spec asserting only "our ids contain no colon" would
// pass just as happily if the rule were imagined — and the bug shipped
// precisely because every existing spec mocks the queue, so nothing ever
// handed a real jobId to real BullMQ. It was found in production logs.
//
// The probe ids below carry FOUR and FIVE colon-separated parts because that
// is what the three call sites built. A three-part id is accepted by BullMQ
// (a documented backwards-compatibility trapdoor), so a three-part probe
// would report that no rule exists. The first version of this spec did that.

const SESSION_REF = "report-card-subject-comment:term-1:arm-1:subject-1";
const PRODUCTION_SUBJECT_ID = `${SESSION_REF}:student-1`; // 5 parts — what failed
const PRODUCTION_PARENT_SUMMARY_ID = "parent-summary:school-1:student-1:2026-W38"; // 4 parts

describe("queueJobId", () => {
  it("never produces a colon, even from colon-bearing parts", () => {
    const id = queueJobId(SESSION_REF, "student-1");
    expect(id).not.toContain(":");
    // Colons become underscores; hyphens survive, so a uuid stays greppable.
    expect(id).toContain("report-card-subject-comment_term-1_arm-1_subject-1");
    expect(id).toContain("student-1");
  });

  it("is deterministic, so BullMQ's duplicate-id dedupe still guards the AI budget", () => {
    expect(queueJobId(SESSION_REF, "student-1")).toBe(queueJobId(SESSION_REF, "student-1"));
  });

  it("keeps different tuples distinct, including ones the readable half flattens alike", () => {
    expect(queueJobId("parent-summary", "school", "student", "2026-W38")).not.toBe(
      queueJobId("parent-summary", "school", "student", "2026-W39"),
    );
    // Both reduce to the same readable string; the digest is what separates
    // them. Without it, one of these two jobs would be silently dropped.
    expect(queueJobId("a-", "b")).not.toBe(queueJobId("a", "-b"));
  });

  it("refuses empty parts rather than collapsing two tuples into one id", () => {
    expect(() => queueJobId()).toThrow();
    expect(() => queueJobId("a", "")).toThrow();
    expect(() => queueJobId("a", "   ")).toThrow();
  });
});

// Integration: needs the local Redis from `pnpm db:up`. CI provides one.
//
// The connection is described, not constructed: `apps/api` depends on ioredis
// 5.11 while bullmq pulls 5.10, so handing BullMQ an `IORedis` instance is a
// type error between two copies of the same class. Options are the same shape
// QueueModule passes in production.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const queue = new Queue("job-id-spec", {
  connection: {
    host: redisUrl.hostname,
    port: redisUrl.port ? Number(redisUrl.port) : 6379,
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    maxRetriesPerRequest: null,
  },
});

afterAll(async () => {
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close();
});

describe("BullMQ's own rule (real Redis)", () => {
  it("REJECTS the 5-part id the subject-comment batch was building", async () => {
    await expect(
      queue.add("probe", {}, { jobId: PRODUCTION_SUBJECT_ID }),
    ).rejects.toThrow(/Custom Id cannot contain/i);
  });

  it("REJECTS the 4-part id the weekly parent summary was building", async () => {
    await expect(
      queue.add("probe", {}, { jobId: PRODUCTION_PARENT_SUMMARY_ID }),
    ).rejects.toThrow(/Custom Id cannot contain/i);
  });

  it("ACCEPTS a 3-part colon id — the trapdoor that makes a naive probe lie", async () => {
    // Not an endorsement: this is documented so the two rejections above are
    // read as "four or more parts", not "any colon", by whoever edits next.
    const job = await queue.add("probe", {}, { jobId: "a:b:c" });
    expect(job.id).toBe("a:b:c");
  });

  it("ACCEPTS an id built by queueJobId, so the rejections are not passing for the wrong reason", async () => {
    const id = queueJobId(SESSION_REF, "student-1");
    const job = await queue.add("probe", {}, { jobId: id });
    expect(job.id).toBe(id);
  });

  it("dedupes a repeated id, which is what stops a double tap spending twice", async () => {
    const id = queueJobId("dedupe-probe", "student-1");
    const first = await queue.add("probe", {}, { jobId: id });
    const second = await queue.add("probe", {}, { jobId: id });
    expect(second.id).toBe(first.id);
  });
});
