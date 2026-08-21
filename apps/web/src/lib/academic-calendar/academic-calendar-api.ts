import type { AcademicCalendarInput } from "@school-kit/types";

import { apiFetch } from "@/lib/api-client";

export function getCalendarStatus(): Promise<{ needsCalendar: boolean }> {
  return apiFetch<{ needsCalendar: boolean }>("/schools/me/academic-calendar/status");
}

export function createAcademicCalendar(
  input: AcademicCalendarInput,
): Promise<{ academicYearId: string; currentTermId: string }> {
  return apiFetch<{ academicYearId: string; currentTermId: string }>(
    "/schools/me/academic-calendar",
    { method: "POST", body: input },
  );
}
