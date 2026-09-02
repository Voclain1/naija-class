import { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, type EmbeddingPort } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";

import { EmbeddingService } from "./embedding.service.js";

// Phase 7 / CP1 — EmbeddingService behaviour, without a live key.
//
// The two properties under test are the ones a real key cannot demonstrate:
//
//   1. FAIL-SOFT. With no VOYAGE_API_KEY the service must construct fine,
//      report itself unconfigured, and refuse calls with a typed error — never
//      throw at construction, which would crash-loop the API at boot. A
//      missing env var has already taken this production down once
//      (phase-5.md D11), so this is a regression guard, not a nicety.
//      Note this is testable ONLY by absence: a key would hide it.
//
//   2. LEDGERING. Every call writes an embedding_generations row and accrues
//      cost onto the school's budget period — including FAILED calls, which is
//      the case most likely to be skipped.
//
// The real-API half of CP1's verification lives in
// packages/ai/evals/live-embedding.ts and is run by hand, exactly as
// evals/ab-lesson-plan-format.ts is. Specs must not spend money.

function configWith(key: string | undefined): ConfigService {
  return { get: (name: string) => (name === "VOYAGE_API_KEY" ? key : undefined) } as ConfigService;
}

const okPort: EmbeddingPort = {
  async embed(req) {
    return {
      embeddings: req.inputs.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)),
      totalTokens: 12 * req.inputs.length,
      model: req.model,
    };
  },
};

const failingPort: EmbeddingPort = {
  async embed() {
    throw new Error("Voyage embeddings request failed: 429 Too Many Requests");
  },
};

describe("EmbeddingService — fail-soft with no key", () => {
  it("CONSTRUCTS without throwing when VOYAGE_API_KEY is absent", () => {
    // The whole point: a missing key must not be a boot crash.
    expect(() => new EmbeddingService(configWith(undefined))).not.toThrow();
  });

  it("reports itself unconfigured rather than pretending to work", () => {
    expect(new EmbeddingService(configWith(undefined)).isConfigured()).toBe(false);
    expect(new EmbeddingService(configWith("")).isConfigured()).toBe(false);
    expect(new EmbeddingService(configWith("   ")).isConfigured()).toBe(false);
  });

  it("treats a placeholder key as absent", () => {
    // .env.example ships `pa-replace-me`. A developer who copies it and forgets
    // must get the unconfigured path, not a confusing 401 from the vendor.
    expect(new EmbeddingService(configWith("pa-replace-me")).isConfigured()).toBe(false);
    expect(new EmbeddingService(configWith("placeholder")).isConfigured()).toBe(false);
  });

  it("refuses a call with a typed error, not an empty result", async () => {
    // An empty result would be indistinguishable from "no matching chunks" at
    // the retrieval layer — a silent wrong answer instead of a clear refusal.
    const svc = new EmbeddingService(configWith(undefined));
    await expect(
      svc.embed({ schoolId: "irrelevant", inputs: ["hello"], inputType: "query" }),
    ).rejects.toMatchObject({ code: "EMBEDDING_NOT_CONFIGURED" });
  });

  it("is configured when a real-looking key is present", () => {
    expect(new EmbeddingService(configWith("pa-abc123")).isConfigured()).toBe(true);
  });
});

describe("EmbeddingService — ledgering", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let school: { id: string };

  beforeAll(async () => {
    school = await basePrisma.school.create({
      data: { name: "Embed Ledger", slug: `embed-${runId}` },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await withTenant(school.id, (db) =>
      db.embeddingGeneration.deleteMany({ where: { schoolId: school.id } }),
    );
    await withTenant(school.id, (db) =>
      db.aIBudgetPeriod.deleteMany({ where: { schoolId: school.id } }),
    );
    await withTenant(school.id, (db) =>
      db.curriculumDocument.deleteMany({ where: { schoolId: school.id } }),
    );
    await basePrisma.school.deleteMany({ where: { id: school.id } });
    await basePrisma.$disconnect();
  });

  it("writes a ledger row and accrues cost on success", async () => {
    const svc = new EmbeddingService(configWith(undefined), okPort);
    const out = await svc.embed({
      schoolId: school.id,
      inputs: ["photosynthesis"],
      inputType: "query",
    });

    expect(out.embeddings).toHaveLength(1);
    expect(out.embeddings[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(out.totalTokens).toBe(12);
    // 12 tokens of voyage-4 at $0.06/1M rounds UP to 1 micro-USD — a cost
    // ledger must not round spend down to zero.
    expect(out.costMicroUsd).toBe(1);

    const rows = await withTenant(school.id, (db) =>
      db.embeddingGeneration.findMany({ where: { schoolId: school.id } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].success).toBe(true);
    expect(rows[0].purpose).toBe("query");
    expect(rows[0].documentId).toBeNull();
    expect(rows[0].model).toBe("voyage-4");
  });

  it("marks purpose=ingest when a documentId is supplied", async () => {
    // documentId is what distinguishes the two, and it is also the FK target,
    // so use a real document rather than a fabricated id.
    const doc = await withTenant(school.id, (db) =>
      db.curriculumDocument.create({
        data: {
          schoolId: school.id,
          subjectId: `subj-${runId}`,
          classLevelId: `lvl-${runId}`,
          title: "Scheme",
          storageKey: `curriculum-document/${runId}`,
          checksum: `sum-${runId}`,
          uploadedBy: `user-${runId}`,
        },
        select: { id: true },
      }),
    );

    const svc = new EmbeddingService(configWith(undefined), okPort);
    await svc.embed({
      schoolId: school.id,
      documentId: doc.id,
      inputs: ["week 5", "week 6"],
      inputType: "document",
    });

    const rows = await withTenant(school.id, (db) =>
      db.embeddingGeneration.findMany({ where: { documentId: doc.id } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe("ingest");
    expect(rows[0].inputTokens).toBe(24);
  });

  it("LEDGERS A FAILED CALL, then rethrows", async () => {
    // The case most likely to be skipped, and the one that makes a cost ledger
    // able to answer "why did this month look like that".
    const svc = new EmbeddingService(configWith(undefined), failingPort);

    await expect(
      svc.embed({ schoolId: school.id, inputs: ["boom"], inputType: "query" }),
    ).rejects.toThrow(/429/);

    const failures = await withTenant(school.id, (db) =>
      db.embeddingGeneration.findMany({ where: { schoolId: school.id, success: false } }),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].errorMessage).toContain("429");
    // No tokens were billed, so no cost — but the row exists.
    expect(failures[0].costMicroUsd).toBe(0);
  });

  it("accrues cost onto the budget period WITHOUT touching the Claude token counters", async () => {
    // phase-7.md D4: money is money, but Voyage tokens must not dilute a cap
    // denominated in Claude tokens.
    // Read INSIDE withTenant: ai_budget_periods is under RLS+FORCE, so a
    // basePrisma read with no GUC set correctly returns nothing. (Learned the
    // hard way writing this test — the first version asserted against null.)
    const period = await withTenant(school.id, (db) =>
      db.aIBudgetPeriod.findFirst({ where: { schoolId: school.id } }),
    );

    expect(period).not.toBeNull();
    expect(period!.costMicroUsd).toBeGreaterThan(0);
    expect(period!.tokensReserved).toBe(0);
    expect(period!.tokensActual).toBe(0);
  });

  it("short-circuits an empty input list without calling the vendor", async () => {
    const svc = new EmbeddingService(configWith(undefined), failingPort);
    const out = await svc.embed({ schoolId: school.id, inputs: [], inputType: "query" });
    expect(out.embeddings).toHaveLength(0);
    expect(out.costMicroUsd).toBe(0);
  });
});
