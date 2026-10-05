import type { CbtPackEnvelope } from "@school-kit/types";

const timeOf = (d: Date) => d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });

/** "Fri, 20 Nov, 09:00 (start by 09:30) · 40 min", in this computer's time zone. */
export function describeWhen(e: Pick<CbtPackEnvelope, "startsAt" | "windowEndsAt" | "durationMinutes">): string {
  const start = new Date(e.startsAt);
  const latest = new Date(e.windowEndsAt);
  const day = start.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${timeOf(start)} (start by ${timeOf(latest)}) · ${e.durationMinutes} min`;
}

export const latestStartTime = (e: Pick<CbtPackEnvelope, "windowEndsAt">) => timeOf(new Date(e.windowEndsAt));

/** The label beside each option: A, B, C, D… */
export const optionLetter = (index: number) => String.fromCharCode(65 + index);
