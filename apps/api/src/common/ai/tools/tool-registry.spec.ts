import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  MODELS,
  type AiAssistantTurn,
  type AiCallRequest,
  type AiCallResult,
  type AiConversationRequest,
  type AiConversationResult,
  type AnthropicPort,
} from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";

import type { AuthContext } from "../../auth/auth-context";
import { AiGenerationService } from "../ai-generation.service.js";
import {
  TOOL_OUTPUT_MAX_CHARS,
  TOOL_REFUSAL,
  ToolRegistry,
  type ReadToolDefinition,
} from "./tool-registry";

// FD-3a — the read-only tool registry (docs/reviews/agentic-implementation-plan.md
// §3.3, §4.4). Real Postgres: who is active and which permissions a role holds
// are real rows, read the way PermissionsGuard reads them.

const runId = Math.random().toString(36).slice(2, 8);
const schoolIds: string[] = [];

async function makeSchool(name: string) {
  const s = await basePrisma.school.create({
    data: { name: `${name} ${runId}`, slug: `tool-reg-${runId}-${schoolIds.length}` },
    select: { id: true },
  });
  schoolIds.push(s.id);
  return s.id;
}

async function makeStaff(schoolId: string, roleKey: string): Promise<AuthContext> {
  const userId = await withTenant(schoolId, async (db) => {
    const u = await db.user.create({
      data: {
        schoolId,
        firstName: roleKey,
        lastName: `Tools-${runId}`,
        email: `${roleKey}-${runId}-${Math.random().toString(36).slice(2, 6)}@example.test`,
        passwordHash: "argon2id$placeholder",
      },
      select: { id: true },
    });
    const role = await db.role.findFirst({ where: { schoolId: null, key: roleKey, isSystem: true }, select: { id: true } });
    if (!role) throw new Error(`system role '${roleKey}' not seeded — run pnpm db:seed`);
    await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
    return u.id;
  });
  return { sessionId: "test-session", userId, schoolId };
}

let runs = 0;

const SCHOOL_NAME_TOOL: ReadToolDefinition<z.ZodObject<{ verbose: z.ZodOptional<z.ZodBoolean> }, "strict">> = {
  name: "school_name",
  description: "Returns the name of the signed-in user's school.",
  access: { kind: "permissions", permissions: ["grading-scheme.read"] },
  effect: "read",
  args: z.object({ verbose: z.boolean().optional() }).strict(),
  inputSchema: {
    type: "object",
    properties: { verbose: { type: "boolean" } },
    required: [],
    additionalProperties: false,
  },
  outputFields: ["schoolName"],
  async run(ctx) {
    runs += 1;
    const school = await withTenant(ctx.authCtx.schoolId, (db) =>
      db.school.findUnique({ where: { id: ctx.authCtx.schoolId }, select: { name: true } }),
    );
    // `secret` is NOT in outputFields and must never reach the model.
    return { schoolName: school?.name ?? null, secret: "SECRET-FIELD" };
  },
};

const OPEN_TOOL: ReadToolDefinition<z.ZodObject<Record<string, never>, "strict">> = {
  name: "big_output",
  description: "Returns a very large value, to test the size cap.",
  access: { kind: "anyActiveStaff", reason: "Test tool: returns no school data, only filler text." },
  effect: "read",
  args: z.object({}).strict(),
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  outputFields: ["filler"],
  async run() {
    return { filler: "x".repeat(TOOL_OUTPUT_MAX_CHARS * 2) };
  },
};

function registry() {
  const r = new ToolRegistry();
  r.register(SCHOOL_NAME_TOOL);
  r.register(OPEN_TOOL);
  return r;
}

const call = (name: string, input: unknown = {}) => ({ id: `toolu_${name}`, name, input });

describe("ToolRegistry — registration refuses an unsafe tool", () => {
  const base = SCHOOL_NAME_TOOL as unknown as ReadToolDefinition<z.AnyZodObject>;
  const refused = (over: Partial<ReadToolDefinition<z.AnyZodObject>>, pattern: RegExp) =>
    expect(() => new ToolRegistry().register({ ...base, ...over } as ReadToolDefinition<z.AnyZodObject>)).toThrow(pattern);

  it("no access rule, an empty permission list, '*', or anyActiveStaff without a reason", () => {
    refused({ access: undefined as never }, /no access rule/);
    refused({ access: { kind: "permissions", permissions: [] } }, /declares no permission/);
    refused({ access: { kind: "permissions", permissions: ["*" as never] } }, /may not require "\*"/);
    refused({ access: { kind: "anyActiveStaff", reason: "because" } }, /needs a written reason/);
  });

  it("a write tool, a bad name, a duplicate, no description, no output fields", () => {
    refused({ effect: "write" as never }, /only read tools/);
    refused({ name: "Bad Name" }, /name must be/);
    refused({ description: "short" }, /real description/);
    refused({ outputFields: [] }, /no output fields/);
    const r = new ToolRegistry();
    r.register(base);
    expect(() => r.register(base)).toThrow(/already registered/);
  });

  it("non-strict args, id-like or tenant-like argument names, and a JSON schema that disagrees with args", () => {
    refused({ args: z.object({ verbose: z.boolean().optional() }) }, /strict\(\)/);
    for (const key of ["studentId", "id", "class_id", "schoolId", "tenant"]) {
      refused(
        {
          args: z.object({ [key]: z.string() }).strict(),
          inputSchema: { type: "object", properties: { [key]: { type: "string" } }, required: [key], additionalProperties: false },
        },
        /looks like an id or a tenant/,
      );
    }
    refused({ inputSchema: { type: "object", properties: { other: { type: "string" } }, additionalProperties: false } }, /do not match args/);
    refused({ inputSchema: { type: "object", properties: { verbose: { type: "boolean" } } } }, /additionalProperties: false/);
  });
});

describe("ToolRegistry — every call checked at execution", () => {
  let schoolA: string;
  let schoolB: string;
  let teacherA: AuthContext;
  let bursarA: AuthContext;
  let ownerA: AuthContext;
  let teacherB: AuthContext;

  beforeAll(async () => {
    schoolA = await makeSchool("Tools School A");
    schoolB = await makeSchool("Tools School B");
    teacherA = await makeStaff(schoolA, "teacher");
    bursarA = await makeStaff(schoolA, "bursar");
    ownerA = await makeStaff(schoolA, "owner");
    teacherB = await makeStaff(schoolB, "teacher");
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("a permitted user gets only the allowlisted fields, from their own school", async () => {
    const res = await registry().execute(teacherA, call("school_name"));
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content)).toEqual({ schoolName: `Tools School A ${runId}` });
    expect(res.content).not.toContain("SECRET-FIELD");

    const resB = await registry().execute(teacherB, call("school_name"));
    expect(JSON.parse(resB.content)).toEqual({ schoolName: `Tools School B ${runId}` });
  });

  it("the owner's wildcard grant passes a permission check", async () => {
    const res = await registry().execute(ownerA, call("school_name"));
    expect(res.isError).toBeUndefined();
  });

  it("a user without the permission is refused, and the tool does not run", async () => {
    const before = runs;
    const res = await registry().execute(bursarA, call("school_name"));
    expect(res).toEqual({ toolUseId: "toolu_school_name", content: TOOL_REFUSAL.NOT_PERMITTED, isError: true });
    expect(runs).toBe(before);
  });

  it("a user deactivated mid-conversation is refused at their next call", async () => {
    const user = await makeStaff(schoolA, "teacher");
    const r = registry();
    expect((await r.execute(user, call("school_name"))).isError).toBeUndefined();
    await withTenant(schoolA, (db) => db.user.update({ where: { id: user.userId }, data: { isActive: false } }));
    const before = runs;
    const res = await r.execute(user, call("school_name"));
    expect(res).toMatchObject({ content: TOOL_REFUSAL.INACTIVE, isError: true });
    expect(runs).toBe(before);
  });

  it("a session claiming another school's tenant finds no such user there, and is refused", async () => {
    const forged: AuthContext = { ...teacherA, schoolId: schoolB };
    const before = runs;
    const res = await registry().execute(forged, call("school_name"));
    expect(res).toMatchObject({ content: TOOL_REFUSAL.INACTIVE, isError: true });
    expect(runs).toBe(before);
  });

  it("invalid arguments are refused without echoing them, and the tool does not run", async () => {
    const before = runs;
    for (const input of [{ verbose: "yes" }, { verbose: true, extra: "INPUT-MARK" }, "not-an-object"]) {
      const res = await registry().execute(teacherA, call("school_name", input));
      expect(res).toMatchObject({ content: TOOL_REFUSAL.INVALID_ARGS, isError: true });
      expect(res.content).not.toContain("INPUT-MARK");
    }
    expect(runs).toBe(before);
  });

  it("an unknown tool is refused", async () => {
    expect(await registry().execute(teacherA, call("drop_tables"))).toMatchObject({ content: TOOL_REFUSAL.UNKNOWN, isError: true });
  });

  it("output is capped before it reaches the model", async () => {
    const res = await registry().execute(teacherA, call("big_output"));
    expect(res.content.length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_CHARS + 20);
    expect(res.content.endsWith("[truncated]")).toBe(true);
  });

  it("refusals are logged with the tool name and reason only, never the arguments", async () => {
    const lines: string[] = [];
    vi.spyOn(Logger.prototype, "warn").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    await registry().execute(teacherA, call("school_name", { extra: "INPUT-MARK" }));
    await registry().execute(bursarA, call("school_name", { verbose: true }));
    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).not.toContain("INPUT-MARK");
    expect(lines[0]).toContain("reason=args");
    expect(lines[1]).toContain("reason=permission");
  });

  it("forTurn gives the model every tool in a stable order and binds execution to this user", async () => {
    const turn = registry().forTurn(bursarA);
    expect(turn.tools.map((t) => t.name)).toEqual(["big_output", "school_name"]);
    expect(turn.tools[1]).toEqual({
      name: "school_name",
      description: SCHOOL_NAME_TOOL.description,
      inputSchema: SCHOOL_NAME_TOOL.inputSchema,
    });
    expect(await turn.executeTool(call("school_name"))).toMatchObject({ content: TOOL_REFUSAL.NOT_PERMITTED });
  });

  it("end to end with runConversationTurn: a refused call reaches the model as the fixed refusal text", async () => {
    const seen: AiConversationRequest[] = [];
    const turnObj: AiAssistantTurn = Object.freeze({ kind: "ai-assistant-turn" as const });
    const script: Array<Partial<AiConversationResult> & { stopReason: string }> = [
      { stopReason: "tool_use", toolCalls: [call("school_name")] },
      { stopReason: "end_turn", text: "You can't see that." },
    ];
    const port: AnthropicPort = {
      create: async (_r: AiCallRequest): Promise<AiCallResult> => {
        throw new Error("unused");
      },
      converse: async (req) => {
        seen.push({ ...req, messages: [...req.messages] });
        return { text: "", toolCalls: [], assistantTurn: turnObj, inputTokens: 50, outputTokens: 10, ...script.shift()! };
      },
    };
    await withTenant(schoolA, (db) => db.school.update({ where: { id: schoolA }, data: { aiEnabled: true } }));
    const config = { get: () => undefined } as unknown as ConfigService;
    const { tools, executeTool } = registry().forTurn(bursarA);
    const res = await new AiGenerationService(config, port).runConversationTurn({
      schoolId: schoolA,
      userId: bursarA.userId,
      prompt: { name: "spec-tools", version: "1", model: MODELS.HAIKU_4_5, maxTokens: 100 },
      system: "help",
      history: [{ role: "user", text: "What is our school called?" }],
      tools,
      executeTool,
    });
    expect(res.outcome).toBe("answered");
    expect(seen[1]!.messages[2]).toEqual({
      role: "user",
      toolResults: [{ toolUseId: "toolu_school_name", content: TOOL_REFUSAL.NOT_PERMITTED, isError: true }],
    });
    await withTenant(schoolA, async (db) => {
      await db.aIGeneration.deleteMany({ where: { schoolId: schoolA } });
      await db.aIBudgetPeriod.deleteMany({ where: { schoolId: schoolA } });
    });
  });
});
