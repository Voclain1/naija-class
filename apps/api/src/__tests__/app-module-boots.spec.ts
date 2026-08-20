import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";

// Can the API actually be constructed?
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS. On 2026-08-20, PR #199 (Smart Student Import) shipped a
// controller using `@UseFilters(UploadErrorFilter)` — a bare class reference
// for a filter whose constructor takes a size-label string. Nest tried to
// resolve a `String` provider, found none, and threw during module
// initialisation. The API would not start.
//
// Nothing caught it until CI's e2e job, and there it surfaced as
// "Timed out waiting 180000ms from config.webServer" — a 3-minute timeout
// whose message says nothing about dependency injection. Meanwhile 1,500+
// unit tests, a clean `tsc --noEmit` across 14 packages and a clean lint were
// all green, because every one of those specs constructs its subject with
// `new` and never asks Nest to build anything.
//
// This spec closes that gap for EVERY module at once, in about a second. Any
// controller that wires a parameterised filter, interceptor or guard as a
// class reference; any provider whose interface-typed dependency erased at
// runtime; any module that forgets to import the module supplying one of its
// dependencies — all of them fail here, with the actual Nest error naming the
// actual unresolvable dependency.
//
// ---------------------------------------------------------------------------
// WHY `.compile()` AND NOT `.init()`. compile() builds the DI container and
// instantiates providers, which is exactly where dependency resolution
// happens and therefore all this spec needs. init() would additionally run
// onModuleInit / onApplicationBootstrap — registering cron schedules, having
// PartitionService create next month's audit_logs partition, opening BullMQ
// workers. Those are real side effects on a shared database, and none of them
// are what this spec is asking about. Keep it at compile().
//
// This is the same lesson ai.module.spec.ts records for AiModule and
// student-scan.module.spec.ts records for StudentScanModule, generalised:
// those two are fast, targeted signals for their own wiring; this is the net
// underneath every module, including ones nobody thought to write a spec for.
describe("AppModule", () => {
  it("compiles — every provider, controller and enhancer in the app resolves", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
