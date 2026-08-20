import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { AuthGuard } from "../../common/auth/auth.guard.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { StudentScanModule } from "./student-scan.module.js";
import { StudentScanService } from "./student-scan.service.js";

// The two guards are overridden and everything else is left real.
//
// That split is the whole point of this spec rather than an incidental
// convenience. AuthGuard depends on REDIS_AUTH_CLIENT, which RedisAuthModule
// supplies @Global()ly once AppModule has imported it — so in isolation it is
// unresolvable for reasons that have nothing to do with this module's own
// wiring, and leaving it in would make the spec fail identically whether the
// code under test is correct or broken. A test that fails either way tests
// nothing.
//
// Filters and interceptors are deliberately NOT overridden: they are where
// the bug this spec exists for actually lived.
const compileModule = () =>
  Test.createTestingModule({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }), StudentScanModule],
  })
    .overrideGuard(AuthGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(PermissionsGuard)
    .useValue({ canActivate: () => true })
    .compile();

// A BOOT test, not a behaviour test.
//
// This exists because PR #199's first CI run died here, and nothing local
// caught it. student-scan.service.spec.ts builds the service with `new`, so
// it never touches Nest's DI container — and the container is where this
// module is actually constructed in production. 50 green tests, a clean
// typecheck and a clean lint all coexisted with an API that would not start.
//
// The specific bug: the controller used `@UseFilters(UploadErrorFilter)` — a
// bare class reference — for a filter whose constructor takes a size-label
// string. Nest tried to resolve a `String` provider, found none, and threw
// "Nest can't resolve dependencies of the UploadErrorFilter (?)" during
// module initialisation. The correct form is `new UploadErrorFilter("10 MB")`,
// which the filter's own header comment states plainly.
//
// Why that failure mode is worth a dedicated spec rather than a code comment:
// it is a CRASH AT BOOT, not at the first upload. In this project that is the
// worst available shape of bug — there is no isolated staging environment
// (every "staging" deploy hits the production database), so a module that
// cannot construct takes the API down for every live school at once, and
// phase-5.md D11's fail-soft design exists precisely because a boot crash
// from a missing env var has already done that once here.
//
// This is the same lesson ai.module.spec.ts records for AiModule. Any future
// module whose controller wires a parameterised filter, interceptor or guard
// should get one of these: the failure is invisible to direct-construction
// unit tests and only appears when something first asks Nest to build it.
describe("StudentScanModule", () => {
  it("compiles — every controller-level filter, guard and interceptor resolves", async () => {
    const moduleRef = await compileModule();

    expect(moduleRef.get(StudentScanService)).toBeInstanceOf(StudentScanService);
    await moduleRef.close();
  });

  it("reports itself unconfigured rather than throwing when no API key is set", async () => {
    // Fail-soft, per phase-5.md D11. A school with AI switched off must see a
    // disabled scan button, not a 500 — and certainly not a boot failure.
    // ignoreEnvFile + an explicit delete keeps this deterministic on a
    // developer machine whose .env holds a key and in CI where it may not.
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const moduleRef = await compileModule();

      expect(moduleRef.get(StudentScanService).isConfigured()).toBe(false);
      await moduleRef.close();
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
