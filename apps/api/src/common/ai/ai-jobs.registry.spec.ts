import { describe, expect, it } from "vitest";

import { AiJobRegistry } from "./ai-jobs.registry";

describe("AiJobRegistry", () => {
  it("runs a registered handler with the job's data", async () => {
    const registry = new AiJobRegistry();
    registry.register<{ schoolId: string; n: number }>("double", { required: ["schoolId", "n"], run: async (d) => d.n * 2 });
    await expect(registry.dispatch("double", "1", { schoolId: "s", n: 21 })).resolves.toBe(42);
  });

  it("refuses a job missing its school or target, naming what is missing", async () => {
    const registry = new AiJobRegistry();
    let ran = false;
    registry.register<{ schoolId: string; studentId: string }>("x", { required: ["schoolId", "studentId"], run: async () => (ran = true) });
    await expect(registry.dispatch("x", "7", { studentId: "a" })).rejects.toThrow("x: job 7 missing schoolId; refusing to run");
    await expect(registry.dispatch("x", "7", { schoolId: "", studentId: "a" })).rejects.toThrow(/missing schoolId/);
    expect(ran).toBe(false);
  });

  it("refuses an unknown job name, and a name registered twice", async () => {
    const registry = new AiJobRegistry();
    await expect(registry.dispatch("nope", undefined, {})).rejects.toThrow("unknown job name on ai queue: nope");
    registry.register("a", { required: [], run: async () => null });
    expect(() => registry.register("a", { required: [], run: async () => null })).toThrow(/registered twice/);
  });
});
