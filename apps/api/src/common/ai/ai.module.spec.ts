import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

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
describe("AiModule", () => {
  it("Nest's DI container can resolve AiGenerationService", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AiModule],
    }).compile();

    const service = moduleRef.get(AiGenerationService);
    expect(service).toBeInstanceOf(AiGenerationService);
    // No ANTHROPIC_API_KEY in the test env, so it must report itself
    // unconfigured rather than having thrown during construction.
    expect(service.isConfigured()).toBe(false);
  });
});
