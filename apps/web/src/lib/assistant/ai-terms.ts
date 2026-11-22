import type { SchoolAiTermsDto } from "@school-kit/types";

// What the Data protection page says about the SchoolKit Assistant's AI terms
// (docs/modules/assistant-ai-governance.md, "School AI terms"). Pure, so the
// wording rules are tested without a browser.

export type AiTermsView =
  | { kind: "loading" }
  | { kind: "accepted"; text: string }
  | { kind: "needed"; text: string; canDecide: boolean };

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
}

export function aiTermsView(status: SchoolAiTermsDto | null): AiTermsView {
  if (!status) return { kind: "loading" };
  const by = status.latest?.byName ? ` by ${status.latest.byName}` : "";
  if (status.accepted && status.latest) {
    return { kind: "accepted", text: `Accepted on ${day(status.latest.at)}${by}. Only SchoolKit can switch AI understanding on or off for your school.` };
  }
  const why =
    status.latest?.action === "WITHDRAW"
      ? `Withdrawn on ${day(status.latest.at)}${by}. AI understanding is stopped for your school.`
      : status.latest
        ? `These terms changed on ${day(status.currentVersion)}. AI understanding stays stopped until they are accepted again.`
        : "Not accepted. AI understanding cannot be used at your school until the owner accepts these terms.";
  return { kind: "needed", text: why, canDecide: status.canDecide };
}
