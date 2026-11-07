import type { z } from "zod";

import { ToolRegistry, type ReadToolDefinition } from "./tool-registry";

// ---------------------------------------------------------------------------
// The assistant's tools: the ONE list a conversation's registry is built from
// (docs/reviews/agentic-implementation-plan.md §3.3).
//
// Empty in FD-3b. The first real tools arrive with the help assistant (FD-5b).
// Every tool added here is run by the conformance gate
// (__tests__/assistant-tool-conformance.spec.ts) over a fixture school full of
// names, contact details, money, behaviour and health records, and CI fails if
// any of it reaches the model. Adding a tool also means adding its name to that
// spec's pinned list, a visible edit, like the SECURITY DEFINER inventory.
// ---------------------------------------------------------------------------

export const ASSISTANT_TOOLS: ReadonlyArray<ReadToolDefinition<z.AnyZodObject>> = [];

/** A registry holding every assistant tool. Registration refusals throw here, at boot. */
export function buildAssistantToolRegistry(
  tools: ReadonlyArray<ReadToolDefinition<z.AnyZodObject>> = ASSISTANT_TOOLS,
): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of tools) registry.register(tool);
  return registry;
}
