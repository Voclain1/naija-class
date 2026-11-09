// LIVE eval for the SchoolKit Assistant's model orchestration: the real model,
// the production system prompt and tool specs, simulated tools
// (../assistant-orchestrator/scenarios.ts). Spends real tokens.
//
// Skipped, loudly, when ANTHROPIC_API_KEY is absent or a placeholder, as the
// other live cases are. A skip is reported as a skip, never as a pass: model
// quality is NOT verified by the offline checks or by the API's scripted-port
// tests, which verify what the server does with the model's choices.

import { createAnthropicClient, type AiConversationMessage, type AiToolCall } from "../../src/client.js";
import { ASSISTANT_ORCHESTRATOR_PROMPT, ASSISTANT_ORCHESTRATOR_SYSTEM, ASSISTANT_ORCHESTRATOR_TOOLS } from "../../src/prompts/assistant-orchestrator.js";
import { SCENARIOS, simulateTool, type Scenario } from "../assistant-orchestrator/scenarios.js";
import { check, skip, type CheckResult, type EvalCase } from "../harness.js";

const MAX_STEPS = 6;

export async function play(client: NonNullable<ReturnType<typeof createAnthropicClient>>, sc: Scenario): Promise<{ calls: AiToolCall[]; reply: string; stop: string | null }> {
  const messages: AiConversationMessage[] = sc.history.map((text, i) => (i % 2 === 0 ? { role: "user" as const, text } : { role: "assistant" as const, text }));
  messages.push({ role: "user", text: `${sc.user}\n\n${sc.tasks}` });
  const calls: AiToolCall[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await client.converse!({
      model: ASSISTANT_ORCHESTRATOR_PROMPT.model,
      system: ASSISTANT_ORCHESTRATOR_SYSTEM,
      maxTokens: ASSISTANT_ORCHESTRATOR_PROMPT.maxTokens,
      messages,
      tools: ASSISTANT_ORCHESTRATOR_TOOLS,
    });
    if (r.stopReason !== "tool_use") return { calls, reply: r.text, stop: r.stopReason };
    calls.push(...r.toolCalls);
    messages.push({ role: "assistant", turn: r.assistantTurn });
    messages.push({ role: "user", toolResults: r.toolCalls.map((c) => ({ toolUseId: c.id, content: JSON.stringify(simulateTool(c)) })) });
  }
  return { calls, reply: "", stop: "step_limit" };
}

export const assistantOrchestratorLiveCase: EvalCase = {
  suite: "SchoolKit Assistant orchestration — LIVE understanding (requires ANTHROPIC_API_KEY)",
  async run(): Promise<CheckResult[]> {
    const key = process.env.ANTHROPIC_API_KEY;
    const usable = key && key.trim() !== "" && !key.includes("placeholder") && !key.includes("replace-me");
    if (!usable) {
      return SCENARIOS.map((s) => skip(`live: ${s.name}`, "ANTHROPIC_API_KEY not set (or is a placeholder): model understanding NOT verified"));
    }
    const client = createAnthropicClient(key);
    if (!client?.converse) return [check("live client with converse()", false, "client could not be constructed")];
    const out: CheckResult[] = [];
    for (const sc of SCENARIOS) {
      let result: Awaited<ReturnType<typeof play>>;
      try {
        result = await play(client, sc);
      } catch (e) {
        out.push(check(`live: ${sc.name}`, false, `call failed: ${e instanceof Error ? e.message : String(e)}`));
        continue;
      }
      out.push(check(`live: ${sc.name}: finished its turn`, result.stop === "end_turn", `stop=${result.stop}`));
      for (const [label, fn] of sc.expect) {
        const why = fn(result.calls, result.reply);
        out.push(check(`live: ${sc.name}: ${label}`, why === null, why ?? undefined));
      }
    }
    return out;
  },
};
