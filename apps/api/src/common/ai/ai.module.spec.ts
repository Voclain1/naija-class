import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AiGenerationService } from "./ai-generation.service.js";
import { AiModule } from "./ai.module.js";

// This spec exists because ai-generation.service.spec.ts constructs the
// service with `new`, which never exercises Nest's DI container — and the
// container is where this class actually gets built in production.
//
// It caught a real bug on first run: AnthropicPort is a TypeScript interface,
// so it erases at runtime and reflect-metadata reports the optional
// constructor parameter as `Object`. Nest then tried to resolve a provider
// for it and failed with "Nest can't resolve dependencies of the
// AiGenerationService (ConfigService, ?)" — meaning AiModule was
// unconstructable, while all 1426 other tests stayed green. The fix is the
// AI_PORT token plus @Optional().
//
// Keep this spec for every future common-module service whose constructor
// takes an interface-typed dependency: the failure mode is invisible to
// direct-construction unit tests and only appears when a feature module first
// imports the module — i.e. in the NEXT slice, far from the cause.
//
// ENV DISCIPLINE (added after PR #158 went red in CI): the configured/
// unconfigured assertions below set ANTHROPIC_API_KEY explicitly rather than
// reading whatever the ambient environment happens to hold. The original
// version asserted only `isConfigured() === false` on the assumption that no
// key exists during tests — true locally (`.env` holds `sk-ant-placeholder`,
// which the service reads as absent) but false in CI, whose `.env` used a
// value with no "placeholder" substring. The test was really asserting a
// property of the developer's `.env` file. `ignoreEnvFile` plus an explicit
// process.env keeps both branches deterministic on any machine.
describe("AiModule", () => {
  const KEY = "ANTHROPIC_API_KEY";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  async function buildService(): Promise<AiGenerationService> {
    const moduleRef = await Test.createTestingModule({
      // ignoreEnvFile: the repo-root .env is already loaded into process.env
      // by the dotenv-cli test wrapper; reading it again here would let the
      // developer's own key override what each test sets below.
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AiModule],
    }).compile();
    return moduleRef.get(AiGenerationService);
  }

  it("Nest's DI container can resolve AiGenerationService", async () => {
    delete process.env[KEY];
    const service = await buildService();
    expect(service).toBeInstanceOf(AiGenerationService);
  });

  it("reports itself unconfigured when no key is present", async () => {
    delete process.env[KEY];
    // Must report disabled rather than having thrown during construction —
    // the fail-soft contract in phase-5.md D11.
    expect((await buildService()).isConfigured()).toBe(false);
  });

  it("reports itself unconfigured for a placeholder key", async () => {
    // The value CI and local .env both carry. Constructing a client around it
    // would mean a live request on the first generate call.
    process.env[KEY] = "sk-ant-placeholder-not-used-in-ci";
    expect((await buildService()).isConfigured()).toBe(false);
  });

  it("reports itself configured when a real-looking key is present", async () => {
    // The other half of the contract: without this, the two assertions above
    // would still pass if isConfigured() were hardcoded to false. No network
    // call happens here — the client is constructed, not used.
    process.env[KEY] = "sk-ant-api03-test-key-shaped-value";
    expect((await buildService()).isConfigured()).toBe(true);
  });
});
