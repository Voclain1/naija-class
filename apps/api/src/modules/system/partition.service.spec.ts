import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});
