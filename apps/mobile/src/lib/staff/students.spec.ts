import type { StudentDetailDto, StudentListResponse } from "@school-kit/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "../api/client";
import {
  staffCreateStudent,
  staffGetStudent,
  staffGraduateStudent,
  staffListStudents,
  staffWithdrawStudent,
} from "../api/staff-students";
import { isSchoolAdmin } from "../auth/roles";
import { resetServerClock } from "./server-date";
import {
  EMPTY_STUDENT_FORM,
  buildCreateStudentInput,
  isoDateFromParts,
  validateStudentForm,
  type StudentFormValues,
} from "./student-form";

const FILLED: StudentFormValues = {
  ...EMPTY_STUDENT_FORM,
  admissionNumber: "VF/2026/041",
  firstName: "Adaeze",
  lastName: "Okafor",
  dobDay: "14",
  dobMonth: "3",
  dobYear: "2013",
  gender: "FEMALE",
};

describe("who may open Students", () => {
  it("is owners and admins — the ROLE the server checks", () => {
    expect(isSchoolAdmin([{ key: "owner" }])).toBe(true);
    expect(isSchoolAdmin([{ key: "admin" }])).toBe(true);
  });

  it("is NOT a teacher, even though teachers hold student.read", () => {
    // Teachers need student.read for their class lists. StudentsService still
    // refuses them, so a tile gated on the permission would be a broken tile.
    expect(isSchoolAdmin([{ key: "teacher" }])).toBe(false);
    expect(isSchoolAdmin([{ key: "bursar" }])).toBe(false);
  });
});

describe("dates typed as day, month, year", () => {
  it("assembles a real date", () => {
    expect(isoDateFromParts("14", "3", "2013")).toBe("2013-03-14");
    expect(isoDateFromParts("1", "12", "2010")).toBe("2010-12-01");
  });

  it("rejects a date the calendar does not have, instead of rolling it over", () => {
    expect(isoDateFromParts("31", "2", "2014")).toBeNull();
    expect(isoDateFromParts("29", "2", "2013")).toBeNull();
    expect(isoDateFromParts("29", "2", "2012")).toBe("2012-02-29"); // leap year
  });

  it("rejects half-typed or two-digit years", () => {
    expect(isoDateFromParts("14", "3", "13")).toBeNull();
    expect(isoDateFromParts("", "3", "2013")).toBeNull();
    expect(isoDateFromParts("14", "13", "2013")).toBeNull();
  });
});

describe("class placement has NO default", () => {
  it("blocks saving until placement is answered", () => {
    // The 2026-08-25 carry-over incident was a pre-ticked default enrolling a
    // whole school. An unanswered placement must stop the form.
    const errors = validateStudentForm(FILLED, { kind: "unanswered" }, "2026-09-21");
    expect(errors.placement).toBeDefined();
  });

  it("accepts 'place later' as a real, deliberate answer", () => {
    const errors = validateStudentForm(FILLED, { kind: "later" }, "2026-09-21");
    expect(errors).toEqual({});
    const input = buildCreateStudentInput(FILLED, { kind: "later" }, "term-1");
    // No enrollment at all — the API's legitimate "not yet placed" state.
    expect(input.enrollment).toBeUndefined();
  });

  it("enrols into the chosen class for the resolved current term", () => {
    const input = buildCreateStudentInput(FILLED, { kind: "arm", classArmId: "arm-1" }, "term-1");
    expect(input.enrollment).toEqual({ termId: "term-1", classArmId: "arm-1" });
  });

  it("refuses rather than silently dropping a chosen class when there is no term", () => {
    expect(() =>
      buildCreateStudentInput(FILLED, { kind: "arm", classArmId: "arm-1" }, null),
    ).toThrow("NO_CURRENT_TERM");
  });

  it("will not build a payload while placement is unanswered", () => {
    expect(() => buildCreateStudentInput(FILLED, { kind: "unanswered" }, "term-1")).toThrow();
  });
});

describe("form validation", () => {
  it("names each missing required field", () => {
    const errors = validateStudentForm(EMPTY_STUDENT_FORM, { kind: "later" }, "2026-09-21");
    expect(Object.keys(errors).sort()).toEqual(
      ["admissionNumber", "dateOfBirth", "firstName", "gender", "lastName"].sort(),
    );
  });

  it("judges 'born in the future' against the SERVER's date", () => {
    const errors = validateStudentForm(
      { ...FILLED, dobDay: "1", dobMonth: "1", dobYear: "2027" },
      { kind: "later" },
      "2026-09-21",
    );
    expect(errors.dateOfBirth).toMatch(/future/);
  });

  it("sends optional fields only when filled, trimmed", () => {
    const input = buildCreateStudentInput(
      { ...FILLED, middleName: "  ", phone: " 08031234567 " },
      { kind: "later" },
      null,
    );
    expect(input.middleName).toBeUndefined();
    expect(input.phone).toBe("08031234567");
    expect(input.firstName).toBe("Adaeze");
  });
});

// ---------------------------------------------------------------------------
// Bindings, with fixtures typed from the API's own DTOs.

const LIST: StudentListResponse = { data: [], meta: { cursor: "next-1" } };

describe("student bindings", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetServerClock();
    setTokenProvider(() => "test-token");
    fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTokenProvider(() => null);
  });

  function lastCall(): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
    return { url, init };
  }

  it("searches and pages the list, and returns the paging cursor", async () => {
    const result = await staffListStudents({ search: "Ada", cursor: "c-1" });
    const url = new URL(lastCall().url);
    expect(url.pathname).toMatch(/\/students$/);
    expect(url.searchParams.get("search")).toBe("Ada");
    expect(url.searchParams.get("cursor")).toBe("c-1");
    expect(result.meta.cursor).toBe("next-1");
  });

  it("reads one student's full record, guardians included", async () => {
    const detail = { id: "s-1", guardians: [] } as unknown as StudentDetailDto;
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(detail))));
    const result = await staffGetStudent("s-1");
    expect(lastCall().url).toMatch(/\/students\/s-1$/);
    expect(result.guardians).toEqual([]);
  });

  it("creates with exactly the built payload", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: "s-2" }))));
    const input = buildCreateStudentInput(FILLED, { kind: "arm", classArmId: "arm-1" }, "term-1");
    await staffCreateStudent(input);
    const body = JSON.parse(String(lastCall().init.body));
    expect(body.enrollment).toEqual({ termId: "term-1", classArmId: "arm-1" });
    expect(body.dateOfBirth).toBe("2013-03-14T00:00:00.000Z");
  });

  it("withdraws and graduates through their own endpoints", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: "s-1" }))));
    await staffWithdrawStudent("s-1", { reason: "Relocated" });
    expect(lastCall().url).toMatch(/\/students\/s-1\/withdraw$/);
    await staffGraduateStudent("s-1", {});
    expect(lastCall().url).toMatch(/\/students\/s-1\/graduate$/);
  });
});
