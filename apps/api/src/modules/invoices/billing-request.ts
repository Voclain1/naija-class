import { ConflictError, type BillingContextDto } from "@school-kit/types";

const normalise = (s: string) => s.toLowerCase().replace(/\b(jss|sss|ss|pry|primary)\s*(\d+)/g, "$1 $2").replace(/\b((?:jss|sss|ss|pry|primary) \d+)([a-z])\b/g, "$1 $2").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const fail = () => new ConflictError("BILLING_CLARIFY", "Please choose the classes below. I could not resolve the whole instruction safely. No invoices were created.");

/** Local, fail-closed scope resolution. User text never becomes a model input. */
export function resolveBillingRequest(request: string, context: BillingContextDto, termId: string): string[] {
  let text = ` ${normalise(request)} `;
  if (!/\b(generate|create|prepare|issue|bill)\b/.test(text)) throw fail();
  // Negations/conditions must never turn into an unconditional billing run.
  if (/\b(not|except|exclude|only|unless|without|discount|increase|decrease|send|sms|notify|refund|cancel|paid|unpaid|owing)\b/.test(text)) throw fail();
  const term = context.terms.find((t) => t.id === termId);
  if (!term) throw fail();
  if (/\b(current|this) term\b/.test(text) && !term.isCurrent) throw fail();
  const aliases = new Map<string, Set<string>>();
  for (const arm of context.arms) {
    for (const label of [arm.name, `${arm.level} ${arm.name}`, arm.level]) {
      const key = normalise(label);
      if (!key) continue;
      const ids = aliases.get(key) ?? new Set<string>();
      ids.add(arm.id); aliases.set(key, ids);
    }
  }
  // Resolve the longest names first, so JSS 2 A does not also select JSS 2 B.
  const picked = new Set<string>();
  for (const [alias, ids] of [...aliases].sort((a, b) => b[0].length - a[0].length)) {
    const needle = ` ${alias} `;
    if (!text.includes(needle)) continue;
    // Arm names reused across levels ("A") are ambiguous. The UI must resolve.
    if (ids.size > 1 && !context.arms.some((a) => normalise(a.level) === alias)) throw fail();
    for (const id of ids) picked.add(id);
    text = text.split(needle).join(" ");
  }
  const all = /\ball (classes|arms|students)\b|\bwhole school\b|\bevery (class|arm|student)\b/.test(text);
  const scopedQuantifier = /\b(all|every) (classes|arms|students|class|arm|student) (in|of|for)\b/.test(text) && !/\bwhole school\b/.test(text);
  if (all && picked.size && !scopedQuantifier) throw fail();
  if (all && !picked.size) context.arms.forEach((a) => picked.add(a.id));
  for (const phrase of [normalise(term.name), normalise(term.year), "selected term", "this term", "current term", "whole school"]) {
    if (phrase) text = text.split(` ${phrase} `).join(" ");
  }
  // A fixed grammar, not redaction. Anything unrecognised prevents execution.
  text = text.replace(/\b(please|can|could|you|help|me|generate|create|prepare|issue|bill|invoices?|fees?|for|the|all|every|classes|class|arms|arm|students|student|and|in|of|our|school|now)\b/g, " ").trim();
  if (text || picked.size === 0) throw fail();
  return [...picked].sort();
}
