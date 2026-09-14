// Typed wrapper around /timetable (Phase 8 / CP3, docs/modules/phase-8.md §17).
// Shapes come from @school-kit/types so the client cannot drift from the API.

import type {
  BellScheduleDto,
  CopyResultDto,
  CopyTimetableInput,
  PublishResultDto,
  TeacherTimetableDto,
  WithdrawPublicationInput,
  ClearLessonInput,
  CreateTimetableInput,
  LessonDto,
  SaveBellScheduleInput,
  SaveLessonInput,
  SaveLessonResultDto,
  TimetableClashDto,
  TimetableHeaderDto,
  TimetableOptionsDto,
  TimetableViewDto,
} from "@school-kit/types";

import { ApiError, apiFetch } from "../api-client";

export function getBellSchedule(): Promise<BellScheduleDto> {
  return apiFetch<BellScheduleDto>("/timetable/bell-schedule");
}

export function saveBellSchedule(input: SaveBellScheduleInput): Promise<BellScheduleDto> {
  return apiFetch<BellScheduleDto>("/timetable/bell-schedule", { method: "PUT", body: input });
}

export function getTimetableOptions(): Promise<TimetableOptionsDto> {
  return apiFetch<TimetableOptionsDto>("/timetable/options");
}

export function getTimetableView(classArmId: string, termId: string): Promise<TimetableViewDto> {
  const qs = `classArmId=${encodeURIComponent(classArmId)}&termId=${encodeURIComponent(termId)}`;
  return apiFetch<TimetableViewDto>(`/timetable/view?${qs}`);
}

export function createTimetable(input: CreateTimetableInput): Promise<TimetableHeaderDto> {
  return apiFetch<TimetableHeaderDto>("/timetable/timetables", { method: "POST", body: input });
}

export function deleteTimetable(id: string): Promise<void> {
  return apiFetch<void>(`/timetable/timetables/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function saveLesson(input: SaveLessonInput): Promise<SaveLessonResultDto> {
  return apiFetch<SaveLessonResultDto>("/timetable/lessons", { method: "PUT", body: input });
}

export function clearLesson(input: ClearLessonInput): Promise<LessonDto[]> {
  return apiFetch<LessonDto[]>("/timetable/lessons/clear", { method: "POST", body: input });
}

// ---- CP4 (docs/modules/phase-8.md §18) ----

export function getYearClashes(academicYearId: string): Promise<TimetableClashDto[]> {
  return apiFetch<TimetableClashDto[]>(`/timetable/clashes?academicYearId=${encodeURIComponent(academicYearId)}`);
}

/** preview=true runs the real fork and rolls it back, returning every problem (D41/D42). */
export function forkTimetable(id: string, termId: string, preview: boolean): Promise<CopyResultDto> {
  return apiFetch<CopyResultDto>(`/timetable/timetables/${encodeURIComponent(id)}/fork${preview ? "?preview=true" : ""}`, {
    method: "POST",
    body: { termId },
  });
}

/** A refused copy comes back as TIMETABLE_COPY_REFUSED with every problem in details; preview returns them instead. */
export function copyTimetable(id: string, input: CopyTimetableInput, preview: boolean): Promise<CopyResultDto> {
  return apiFetch<CopyResultDto>(`/timetable/timetables/${encodeURIComponent(id)}/copy${preview ? "?preview=true" : ""}`, {
    method: "POST",
    body: input,
  });
}

export function publishTimetable(id: string): Promise<PublishResultDto> {
  return apiFetch<PublishResultDto>(`/timetable/timetables/${encodeURIComponent(id)}/publish`, { method: "POST" });
}

export function withdrawPublication(input: WithdrawPublicationInput): Promise<void> {
  return apiFetch<void>("/timetable/publications/withdraw", { method: "POST", body: input });
}

export function getMyTimetable(termId?: string): Promise<TeacherTimetableDto> {
  return apiFetch<TeacherTimetableDto>(`/teacher-scope/me/timetable${termId ? `?termId=${encodeURIComponent(termId)}` : ""}`);
}

/** The clashes carried by a TIMETABLE_CLASH error, or null for any other error. */
export function clashesOf(e: unknown): TimetableClashDto[] | null {
  if (!(e instanceof ApiError) || e.code !== "TIMETABLE_CLASH") return null;
  const details = e.details as { clashes?: TimetableClashDto[] } | undefined;
  return details?.clashes ?? [];
}
