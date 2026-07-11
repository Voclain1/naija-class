import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { ScheduleModule } from "@nestjs/schedule";

import { basePrisma } from "@school-kit/db";

import { PartitionService } from "./partition.service.js";

describe("PartitionService (integration)", () => {
  let service: PartitionService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [PartitionService],
    }).compile();

    service = module.get(PartitionService);
  });

  afterAll(async () => {
    await basePrisma.$disconnect();
  });

  it("ensurePartition is idempotent — calling twice does not throw", async () => {
    await expect(service.ensurePartition(2026, 9)).resolves.not.toThrow();
    await expect(service.ensurePartition(2026, 9)).resolves.not.toThrow();
  });

  it("row with created_at in 2026-08 routes to audit_logs_2026_08", async () => {
    const id = `test-partition-route-${Date.now()}`;

    await basePrisma.$executeRaw`
      INSERT INTO audit_logs (id, action, created_at)
      VALUES (${id}, 'TEST_PARTITION_ROUTE', '2026-08-15'::TIMESTAMP)
    `;

    const rows = await basePrisma.$queryRaw<{ tableoid_name: string }[]>`
      SELECT c.relname AS tableoid_name
      FROM audit_logs al
      JOIN pg_class c ON c.oid = al.tableoid
      WHERE al.id = ${id}
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.tableoid_name).toBe("audit_logs_2026_08");

    await basePrisma.$executeRaw`
      DELETE FROM audit_logs WHERE id = ${id}
    `;
  });

  it("row outside all named ranges routes to audit_logs_default", async () => {
    const id = `test-partition-default-${Date.now()}`;

    await basePrisma.$executeRaw`
      INSERT INTO audit_logs (id, action, created_at)
      VALUES (${id}, 'TEST_PARTITION_DEFAULT', '2030-01-01'::TIMESTAMP)
    `;

    const rows = await basePrisma.$queryRaw<{ tableoid_name: string }[]>`
      SELECT c.relname AS tableoid_name
      FROM audit_logs al
      JOIN pg_class c ON c.oid = al.tableoid
      WHERE al.id = ${id}
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.tableoid_name).toBe("audit_logs_default");

    await basePrisma.$executeRaw`
      DELETE FROM audit_logs WHERE id = ${id}
    `;
  });

  it("onModuleInit ensures the current and next 2 months without throwing", async () => {
    await expect(service.onModuleInit()).resolves.not.toThrow();
  });

  describe("onModuleInit — non-fatal on DB failure or timeout (fix for the startup hang)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("resolves (never throws) and logs a warning when the DB call rejects", async () => {
      const dbError = new Error("connection terminated unexpectedly");
      vi.spyOn(service, "ensurePartitionsForNextMonths").mockRejectedValueOnce(dbError);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const warnSpy = vi.spyOn((service as any).logger, "warn");

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toContain("connection terminated unexpectedly");
    });

    it("resolves within the timeout ceiling (never hangs) when the DB call never settles", async () => {
      vi.spyOn(service, "ensurePartitionsForNextMonths").mockReturnValueOnce(
        new Promise(() => {
          /* never resolves — simulates a saturated connection pool at startup */
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const warnSpy = vi.spyOn((service as any).logger, "warn");

      const start = Date.now();
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      const elapsed = Date.now() - start;

      // Bounded, not instant and not indefinite — proves the race actually
      // raced rather than the mock coincidentally resolving fast.
      expect(elapsed).toBeGreaterThanOrEqual(4900);
      expect(elapsed).toBeLessThan(8000);
      expect(warnSpy.mock.calls[0]![0]).toContain("timed out");
    });
  });
});
