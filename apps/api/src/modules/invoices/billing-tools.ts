import { z } from "zod";
import { ToolRegistry, type ReadToolDefinition } from "../../common/ai/tools/tool-registry.js";

export interface BillingScopeCounts {
  classCount: number; newInvoiceCount: number; existingInvoiceCount: number; classesMissingFees: number;
}

/** Per-request read tools. Neither tool writes any DB row or operational data.
 * Review intent is held in memory; the service creates the proposal only after
 * an answered turn. The server's scope cannot be changed through arguments. */
export function billingTools(
  check: () => Promise<BillingScopeCounts>, requestReview: () => Promise<boolean>,
): ReadToolDefinition<ReturnType<typeof emptyArgs>>[] {
  const shared = {
    effect: "read" as const,
    access: { kind: "permissions" as const, permissions: ["invoice.read" as const] },
    args: emptyArgs(), inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    conformanceCalls: [{}],
  };
  return [{ ...shared, name: "billing_check_scope",
    description: "Inspect counts and missing-fee exceptions for the server-selected term and classes. No personal data or amounts.",
    outputFields: ["classCount", "newInvoiceCount", "existingInvoiceCount", "classesMissingFees"],
    run: async () => ({ ...await check() }),
  }, { ...shared, name: "billing_request_review",
    description: "Request that the application show the checked preview to a human. This does not create or issue invoices.",
    outputFields: ["reviewRequested"], run: async () => ({ reviewRequested: await requestReview() }),
  }];
}
function emptyArgs() { return z.object({}).strict(); }

export function billingToolRegistry(check: () => Promise<BillingScopeCounts>, requestReview: () => Promise<boolean>) {
  const registry = new ToolRegistry();
  for (const tool of billingTools(check, requestReview)) registry.register(tool);
  return registry;
}
