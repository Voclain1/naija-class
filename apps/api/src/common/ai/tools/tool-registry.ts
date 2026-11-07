import { Logger } from "@nestjs/common";
import { z } from "zod";

import type { AiToolCall, AiToolDefinition, AiToolResult } from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import { PERMISSION_WILDCARD, type Permission } from "@school-kit/types";

import type { AuthContext } from "../../auth/auth-context";

// ---------------------------------------------------------------------------
// Tool registry, read-only (FD-3a, docs/reviews/agentic-implementation-plan.md
// §3.3). The tools a conversation may call, and the ONE place each call is
// checked before it runs.
//
// Why the registry checks permissions itself: an HTTP route is guarded by
// PermissionsGuard, but a tool calls a service method directly, and services
// apply SCOPE (teacher scope, guardian links) but mostly not PERMISSION (audit
// V18). A tool that skipped this would reach data its user's role cannot.
//
// Every call, at execution time (never at registration or turn start):
//   1. the user is re-read and must be active (CLAUDE.md: never trust the
//      session subject alone; a user deactivated mid-conversation is refused
//      at their next tool call);
//   2. the tool's declared permission is checked against the user's current
//      role grants (the same read PermissionsGuard makes), or the tool is
//      explicitly declared open to any active staff member, with a reason;
//   3. the arguments are validated with the tool's Zod schema (strict);
//   4. the tool runs with the tenant taken from the session's AuthContext
//      only — no argument can name a school, and argument names that look
//      like ids are refused at registration in this delivery;
//   5. the output is cut down to the tool's declared field allowlist and a
//      size cap before it is sent to the model.
//
// What the model sees on a refusal is a short, fixed sentence. Never the
// arguments it sent, never an error message, never which check failed beyond
// "not permitted" or "invalid arguments".
//
// FD-3a scope: READ tools only. A write-class tool is refused at registration;
// writes arrive in Stage 5 with proposals and approvals (S2-06a/b, S2-08).
// Staff principal only: guardian and student tools are Stage 6.
// The behaviour/health/PII conformance gate over registered tools is FD-3b.
// ---------------------------------------------------------------------------

/** Who may call a tool: named permissions (all required), or any active staff member with a written reason. */
export type ToolAccess =
  | { readonly kind: "permissions"; readonly permissions: readonly Exclude<Permission, "*">[] }
  | { readonly kind: "anyActiveStaff"; readonly reason: string };

export interface ToolContext {
  /** The signed-in staff member. `authCtx.schoolId` is the ONLY source of the tenant. */
  readonly authCtx: AuthContext;
}

export interface ReadToolDefinition<Args extends z.AnyZodObject> {
  readonly name: string;
  readonly description: string;
  readonly access: ToolAccess;
  /** Only "read" exists in FD-3a. Anything else is refused at registration. */
  readonly effect: "read";
  /** Strict Zod object; validated on every call. */
  readonly args: Args;
  /** The JSON Schema the model is shown. Must describe exactly the same keys as `args`. */
  readonly inputSchema: Record<string, unknown>;
  /** The only top-level fields of the output that reach the model. */
  readonly outputFields: readonly string[];
  run(ctx: ToolContext, args: z.infer<Args>): Promise<Record<string, unknown>>;
}

/** Fixed texts the model gets on a refused call. No input is echoed. */
export const TOOL_REFUSAL = {
  UNKNOWN: "No such tool.",
  NOT_PERMITTED: "Not permitted: this user cannot see that.",
  INACTIVE: "Not permitted: this account is not active.",
  INVALID_ARGS: "Invalid arguments for this tool.",
} as const;

/** Output is capped before it reaches the model. */
export const TOOL_OUTPUT_MAX_CHARS = 8_000;

/**
 * Actions agents may never execute (recommendation R1 in the plan — NOT
 * approved yet). In FD-3a it can never bite, since every write-class tool is
 * refused anyway; it exists so the check is in place before write tools are
 * possible. Listed by tool name.
 */
export const R1_DENIED_TOOL_NAMES: ReadonlySet<string> = new Set<string>([]);

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
// An argument that names a record could reach another school's id, or one the
// model invented. FD-3a has no tool that needs one; opaque handles (S2-05)
// come first.
const ID_LIKE_ARG = /(^id$|Id$|_id$|^school|^tenant)/i;

interface RegisteredTool {
  readonly def: ReadToolDefinition<z.AnyZodObject>;
}

export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools = new Map<string, RegisteredTool>();

  register<Args extends z.AnyZodObject>(def: ReadToolDefinition<Args>): void {
    const fail = (why: string): never => {
      throw new Error(`Tool "${def.name}" refused at registration: ${why}`);
    };
    if (!TOOL_NAME.test(def.name)) fail("name must be lowercase letters, digits and _ (max 64)");
    if (this.tools.has(def.name)) fail("a tool with this name is already registered");
    if (R1_DENIED_TOOL_NAMES.has(def.name)) fail("this action may not be executed by an agent (R1)");
    if (def.description.trim().length < 10) fail("needs a real description");
    if ((def.effect as string) !== "read") fail("only read tools are allowed in this delivery");

    if (!def.access) {
      fail("declares no access rule");
    } else if (def.access.kind === "permissions") {
      if (def.access.permissions.length === 0) fail("declares no permission");
      if (def.access.permissions.some((p) => (p as string) === PERMISSION_WILDCARD)) fail('may not require "*"');
    } else if (def.access.kind === "anyActiveStaff") {
      if (def.access.reason.trim().length < 20) fail("anyActiveStaff needs a written reason");
    } else {
      fail("declares no access rule");
    }

    if (def.outputFields.length === 0) fail("declares no output fields");

    // Arguments: a strict Zod object whose keys match the JSON schema exactly.
    const shapeKeys = Object.keys(def.args.shape).sort();
    if ((def.args._def as { unknownKeys?: string }).unknownKeys !== "strict") fail("args must be z.object(...).strict()");
    for (const key of shapeKeys) {
      if (ID_LIKE_ARG.test(key)) fail(`argument "${key}" looks like an id or a tenant; not allowed yet`);
    }
    const schema = def.inputSchema;
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      fail('inputSchema must be { type: "object", additionalProperties: false }');
    }
    const schemaKeys = Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {}).sort();
    if (JSON.stringify(schemaKeys) !== JSON.stringify(shapeKeys)) {
      fail(`inputSchema properties [${schemaKeys}] do not match args [${shapeKeys}]`);
    }

    this.tools.set(def.name, { def: def as unknown as ReadToolDefinition<z.AnyZodObject> });
  }

  /** Tool names, sorted: the registry's contents for conformance checks. */
  names(): string[] {
    return [...this.tools.keys()].sort();
  }

  /** Access declaration of a registered tool, for conformance checks. */
  accessOf(name: string): ToolAccess | undefined {
    return this.tools.get(name)?.def.access;
  }

  /**
   * What a conversation turn needs: the definitions shown to the model (every
   * registered tool, in a stable order so the prompt prefix stays cacheable),
   * and an executor bound to THIS user. Access is decided per call, at
   * execution, not here.
   */
  forTurn(authCtx: AuthContext): {
    tools: AiToolDefinition[];
    executeTool: (call: AiToolCall) => Promise<AiToolResult>;
  } {
    const tools = this.names().map((name) => {
      const { def } = this.tools.get(name)!;
      return { name: def.name, description: def.description, inputSchema: def.inputSchema };
    });
    return { tools, executeTool: (call) => this.execute(authCtx, call) };
  }

  async execute(authCtx: AuthContext, call: AiToolCall): Promise<AiToolResult> {
    const refuse = (content: string, reason: string): AiToolResult => {
      // Name and reason only; never the arguments.
      this.logger.warn(`AI tool refused: school=${authCtx.schoolId} tool=${call.name} reason=${reason}`);
      return { toolUseId: call.id, content, isError: true };
    };

    const entry = this.tools.get(call.name);
    if (!entry) return refuse(TOOL_REFUSAL.UNKNOWN, "unknown");
    const { def } = entry;

    // 1–2. Re-read the user and their CURRENT grants (as PermissionsGuard does).
    const actor = await loadActor(authCtx);
    if (!actor.isActive) return refuse(TOOL_REFUSAL.INACTIVE, "inactive");
    if (def.access.kind === "permissions") {
      const missing = def.access.permissions.filter((p) => !actor.holds(p));
      if (missing.length > 0) return refuse(TOOL_REFUSAL.NOT_PERMITTED, "permission");
    }

    // 3. Arguments.
    const parsed = def.args.safeParse(call.input ?? {});
    if (!parsed.success) return refuse(TOOL_REFUSAL.INVALID_ARGS, "args");

    // 4. Run with the session's tenant only.
    const output = await def.run({ authCtx }, parsed.data);

    // 5. Allowlist and cap.
    const shaped: Record<string, unknown> = {};
    for (const field of def.outputFields) {
      if (Object.prototype.hasOwnProperty.call(output, field)) shaped[field] = output[field];
    }
    let content = JSON.stringify(shaped);
    if (content.length > TOOL_OUTPUT_MAX_CHARS) {
      content = `${content.slice(0, TOOL_OUTPUT_MAX_CHARS)}… [truncated]`;
    }
    return { toolUseId: call.id, content };
  }
}

interface Actor {
  readonly isActive: boolean;
  holds(permission: string): boolean;
}

// Same two reads PermissionsGuard makes (apps/api/src/common/auth/permissions.guard.ts),
// in one tenant transaction: the user's is_active and their roles' permissions.
async function loadActor(authCtx: AuthContext): Promise<Actor> {
  const { isActive, permissions } = await withTenant(authCtx.schoolId, async (db) => {
    const user = await db.user.findUnique({ where: { id: authCtx.userId }, select: { isActive: true } });
    const grants = await db.userRole.findMany({
      where: { userId: authCtx.userId },
      select: { role: { select: { permissions: true } } },
    });
    const held = new Set<string>();
    for (const g of grants) {
      const list = Array.isArray(g.role.permissions) ? (g.role.permissions as unknown[]) : [];
      for (const p of list) if (typeof p === "string") held.add(p);
    }
    return { isActive: user?.isActive === true, permissions: held };
  });
  return {
    isActive,
    holds: (p) => permissions.has(PERMISSION_WILDCARD) || permissions.has(p),
  };
}
