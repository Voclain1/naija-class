import { sickbayDayOf, sickbayMomentFrom, type RequestHostelExeatInput } from "@school-kit/types";

import type { DateBoxValues } from "../../components/form";

// Phase 9 / CP6b.3, shared since CP11.2 (docs/modules/phase-9.md §20): the
// leave-out form a parent fills in, and the one a house master fills in for a
// request taken by phone. Days are three number boxes, never a picker.

export interface ExeatFormValues {
  outDay: DateBoxValues;
  outTime: string;
  backDay: DateBoxValues;
  backTime: string;
  reason: string;
  collectorName: string;
  collectorRelationship: string;
  collectorPhone: string;
}

export function todayBoxes(now = new Date()): DateBoxValues {
  const [year, month, day] = sickbayDayOf(now).split("-") as [string, string, string];
  return { day, month, year };
}

export function blankExeatForm(now = new Date()): ExeatFormValues {
  return {
    outDay: todayBoxes(now),
    outTime: "09:00",
    backDay: todayBoxes(now),
    backTime: "18:00",
    reason: "",
    collectorName: "",
    collectorRelationship: "",
    collectorPhone: "",
  };
}

function isoDay(v: DateBoxValues): string | null {
  if (!v.day || !v.month || v.year.length !== 4) return null;
  return `${v.year}-${v.month.padStart(2, "0")}-${v.day.padStart(2, "0")}`;
}

/** The request to send, or the first thing to fix, in words. The server checks it again. */
export function exeatFormInput(v: ExeatFormValues): { input: RequestHostelExeatInput } | { error: string } {
  const out = isoDay(v.outDay);
  const back = isoDay(v.backDay);
  if (!out || !back) return { error: "Enter the days out and back in full." };
  if (!/^\d{2}:\d{2}$/.test(v.outTime) || !/^\d{2}:\d{2}$/.test(v.backTime)) return { error: "Enter the times like 09:00 or 18:30." };
  if (!v.reason.trim() || !v.collectorName.trim() || !v.collectorRelationship.trim() || !v.collectorPhone.trim()) {
    return { error: "Fill in the reason and who will collect the child, with their phone number." };
  }
  const outAt = sickbayMomentFrom(out, v.outTime);
  const backBy = sickbayMomentFrom(back, v.backTime);
  if (new Date(backBy) <= new Date(outAt)) return { error: "The time back must be after the time out." };
  return {
    input: {
      outAt,
      backBy,
      reason: v.reason.trim(),
      collectorName: v.collectorName.trim(),
      collectorRelationship: v.collectorRelationship.trim(),
      collectorPhone: v.collectorPhone.trim(),
    },
  };
}
