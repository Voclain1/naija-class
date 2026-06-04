import { describe, expect, it } from "vitest";

import type { ReportCardRenderData } from "@school-kit/types";

import { esc, renderReportCardHtml } from "./report-card-template";

// ---------------------------------------------------------------------------
// esc() is the XSS boundary for the whole template. These tests pin its
// behaviour: it must neutralise every HTML-significant character and collapse
// nullish input to empty string. If esc() regresses, the template leaks raw
// tenant strings into the PDF DOM.
// ---------------------------------------------------------------------------
describe("esc", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(esc("&")).toBe("&amp;");
    expect(esc("<")).toBe("&lt;");
    expect(esc(">")).toBe("&gt;");
    expect(esc('"')).toBe("&quot;");
    expect(esc("'")).toBe("&#39;");
  });

  it("escapes & first so emitted entities are not double-escaped", () => {
    // "<" → "&lt;" and the leading "&" of that entity must come from the input
    // "<", not be re-escaped. A naive ordering would yield "&amp;lt;".
    expect(esc("<>")).toBe("&lt;&gt;");
    expect(esc("a & b < c")).toBe("a &amp; b &lt; c");
  });

  it("neutralises a full <script> XSS payload", () => {
    const payload = "<script>alert('xss')</script>";
    const out = esc(payload);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("</script>");
    expect(out).toBe("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  });

  it("collapses null and undefined to empty string", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });

  it("stringifies numbers", () => {
    expect(esc(0)).toBe("0");
    expect(esc(73)).toBe("73");
  });

  it("is deliberately NOT idempotent (must never be applied twice)", () => {
    // esc re-escapes the '&' it just emitted. Documenting the trap: callers
    // pass raw values exactly once.
    expect(esc(esc("<"))).toBe("&amp;lt;");
  });
});

// A realistic data fixture whose user-controlled string fields ALL carry an XSS
// payload, so the template test can assert none of them survive raw.
const PAYLOAD = "<script>alert('xss')</script>";

function fixture(overrides: Partial<ReportCardRenderData> = {}): ReportCardRenderData {
  return {
    school: { name: PAYLOAD, motto: PAYLOAD, logoUrl: "https://cdn.example.com/logo.png" },
    academicYear: { label: "2025/2026" },
    term: { name: "First Term", startDate: "2025-09-08", endDate: "2025-12-12" },
    classArm: { name: "JSS2 A" },
    student: {
      firstName: PAYLOAD,
      middleName: PAYLOAD,
      lastName: "Adeyemi",
      admissionNumber: "ADM-001",
      gender: "Female",
      dateOfBirth: "2013-04-21",
      photoUrl: null,
    },
    rollup: {
      overallTotal: 540,
      overallAverage: 7350,
      overallPosition: 3,
      subjectsCount: 8,
      formTeacherComment: PAYLOAD,
      principalNote: PAYLOAD,
    },
    subjects: [
      {
        subjectId: "11111111-1111-1111-1111-111111111111",
        subjectName: PAYLOAD,
        totalScore: 87,
        letterGrade: "A",
        remark: "Excellent",
        subjectPosition: 1,
        subjectComment: PAYLOAD,
        components: [
          { componentId: "c1", label: "CA1", score: 18 },
          { componentId: "c2", label: "Exam", score: 69 },
        ],
      },
    ],
    ...overrides,
  };
}

describe("renderReportCardHtml", () => {
  it("produces a complete HTML document", () => {
    const html = renderReportCardHtml(fixture());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("escapes EVERY user-controlled field — no raw <script> survives anywhere", () => {
    const html = renderReportCardHtml(fixture());
    // The only place "<script" should never appear is as an executable tag.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
    // ...but the escaped form is present (proof the payload was rendered, escaped).
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders the frozen rollup: average from Int hundredths, ordinal position", () => {
    const html = renderReportCardHtml(fixture());
    expect(html).toContain("73.50%"); // 7350 hundredths
    expect(html).toContain("3rd"); // overallPosition ordinal
    expect(html).toContain("ADM-001");
  });

  it("formats subject totals, grades and per-component scores", () => {
    const html = renderReportCardHtml(fixture());
    expect(html).toContain("CA1");
    expect(html).toContain("Exam");
    expect(html).toContain(">87<"); // subject total
    expect(html).toContain("1st"); // subject position
  });

  it("renders nullable fields as the em-dash placeholder, never 'null'", () => {
    const html = renderReportCardHtml(
      fixture({
        rollup: {
          overallTotal: null,
          overallAverage: null,
          overallPosition: null,
          subjectsCount: null,
          formTeacherComment: null,
          principalNote: null,
        },
      }),
    );
    expect(html).not.toContain("null");
    expect(html).not.toContain("undefined");
    expect(html).toContain("—");
  });

  it("omits the logo img tag when logoUrl is null", () => {
    const html = renderReportCardHtml(
      fixture({ school: { name: "Greenfield", motto: null, logoUrl: null } }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("class=\"motto\"");
  });
});
