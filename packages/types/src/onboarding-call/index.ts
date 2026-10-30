import { z } from "zod";

import { addDaysIso, formatCalendarDate, isoWeekday, lagosTodayIso } from "../calendar/calendar-dates.js";

// Setup calls (2026-10-26, docs/modules/onboarding-call.md). After the setup
// wizard a new school is offered a free call with the SchoolKit team to finish
// setting up; it books a day and a time, or skips.

/** How SchoolKit is reached: the booking page's footer and the WhatsApp button. */
export const SCHOOLKIT_SUPPORT = {
  email: "hello@schoolkit.ng",
  phoneDisplay: "+234 704 967 7393",
  /** E.164 digits, no "+": what tel: and wa.me take. */
  phoneDigits: "2347049677393",
} as const;

export const ONBOARDING_CALL_DAYS_AHEAD = 14;
/** Monday to Saturday (ISO weekdays). */
export const ONBOARDING_CALL_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6];
/** 09:00 to 16:30 starts, 30 minutes each, Lagos time: the last call ends at 17:00. */
export const ONBOARDING_CALL_SLOT_MINUTES = 30;
export const ONBOARDING_CALL_FIRST_START = 9 * 60;
export const ONBOARDING_CALL_LAST_START = 16 * 60 + 30;

/** The days a call can be booked on: tomorrow onwards, for 14 days, Monday to Saturday. */
export function onboardingCallDays(now: Date = new Date()): string[] {
  const today = lagosTodayIso(now);
  const days: string[] = [];
  for (let i = 1; i <= ONBOARDING_CALL_DAYS_AHEAD; i++) {
    const day = addDaysIso(today, i);
    if (ONBOARDING_CALL_WEEKDAYS.includes(isoWeekday(day))) days.push(day);
  }
  return days;
}

/** The start times offered each day, as minutes since midnight. */
export function onboardingCallStarts(): number[] {
  const starts: number[] = [];
  for (let m = ONBOARDING_CALL_FIRST_START; m <= ONBOARDING_CALL_LAST_START; m += ONBOARDING_CALL_SLOT_MINUTES) starts.push(m);
  return starts;
}

/** 600 → "10:00 am"; 810 → "1:30 pm". */
export function formatCallTime(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "Tue 28 Oct 2026 at 10:00 am". */
export function formatCallSlot(date: string, startMinute: number): string {
  return `${formatCalendarDate(date)} at ${formatCallTime(startMinute)}`;
}

const PHONE_RE = /^\+?[0-9][0-9 ]{8,18}[0-9]$/;

/** POST /schools/me/onboarding-call: book. The day and time are checked against the slots on the server. */
export const bookOnboardingCallSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a day"),
  startMinute: z.number().int().min(0).max(1439),
  contactName: z.string().trim().min(2, "Type your name").max(100),
  contactPhone: z.string().trim().regex(PHONE_RE, "Type a phone number, for example 0803 555 0142"),
  note: z.string().trim().max(500).optional().nullable(),
});
export type BookOnboardingCallInput = z.infer<typeof bookOnboardingCallSchema>;

export interface OnboardingCallBookingDto {
  id: string;
  date: string;
  startMinute: number;
  contactName: string;
  contactPhone: string;
  note: string | null;
  createdAt: string;
}

/** GET /schools/me/onboarding-call. `show`: the page should appear (only to the owner, until they book or skip). */
export interface OnboardingCallStateDto {
  show: boolean;
  /**
   * The owner or an admin of a set-up school with no booking yet may book from
   * the checklist or a setup reminder (/welcome?book=1), even after the page
   * that opens by itself has closed (docs/modules/activation.md).
   */
  canBook: boolean;
  booking: OnboardingCallBookingDto | null;
  /** Pre-fills the form: the owner's name and phone. */
  suggestedName: string;
  suggestedPhone: string;
}

/** GET /platform-admin/onboarding-calls: every booking, newest first. */
export interface PlatformOnboardingCallDto extends OnboardingCallBookingDto {
  schoolId: string;
  schoolName: string;
  schoolSlug: string;
  doneAt: string | null;
}

/** The message the school's own WhatsApp sends us after booking ("Send to SchoolKit on WhatsApp"). */
export function onboardingCallWhatsappText(schoolName: string, booking: Pick<OnboardingCallBookingDto, "date" | "startMinute" | "contactName" | "contactPhone">): string {
  return [
    `Hello SchoolKit, I've booked a setup call for ${schoolName}.`,
    `When: ${formatCallSlot(booking.date, booking.startMinute)} (Lagos time)`,
    `Name: ${booking.contactName}`,
    `Phone: ${booking.contactPhone}`,
  ].join("\n");
}

export function onboardingCallWhatsappUrl(text: string): string {
  return `https://wa.me/${SCHOOLKIT_SUPPORT.phoneDigits}?text=${encodeURIComponent(text)}`;
}
