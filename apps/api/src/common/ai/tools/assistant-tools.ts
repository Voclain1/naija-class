import type { z } from "zod";

import { SETTINGS_TOOLS } from "./settings-tools";
import { ToolRegistry, type ReadToolDefinition } from "./tool-registry";

// ---------------------------------------------------------------------------
// The assistant's tools: the ONE list a conversation's registry is built from
// (docs/reviews/agentic-implementation-plan.md §3.3).
//
// FD-5b adds the settings tools (settings-tools.ts). `help_search_guide`
// joins once FD-5a's guide index is on main.
// Every tool added here is run by the conformance gate
// (__tests__/assistant-tool-conformance.spec.ts) over a fixture school full of
// names, contact details, money, behaviour and health records, and CI fails if
// any of it reaches the model. Adding a tool also means adding its name to that
// spec's pinned list, a visible edit, like the SECURITY DEFINER inventory.
// ---------------------------------------------------------------------------

export const ASSISTANT_TOOLS: ReadonlyArray<ReadToolDefinition<z.AnyZodObject>> = [
  ...(SETTINGS_TOOLS as unknown as ReadonlyArray<ReadToolDefinition<z.AnyZodObject>>),
];

/** A registry holding every assistant tool. Registration refusals throw here, at boot. */
export function buildAssistantToolRegistry(
  tools: ReadonlyArray<ReadToolDefinition<z.AnyZodObject>> = ASSISTANT_TOOLS,
): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of tools) registry.register(tool);
  return registry;
}
