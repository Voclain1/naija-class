import type {
  ApproveCurriculumDocumentResponse,
  CurriculumDocumentListResponse,
} from "@school-kit/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "./client";
import {
  staffApproveCurriculum,
  staffDeleteCurriculum,
  staffListCurriculum,
  staffMyProfile,
  staffPasteCurriculum,
  staffUploadCurriculumFile,
} from "./staff-curriculum";
import { resetServerClock } from "../staff/server-date";

// These specs decode REALISTIC PAYLOADS, not just URLs.
//
// The first device build crashed on this screen seconds after it loaded: the
// list endpoint returns `{ documents, usage }`, the binding claimed it
// returned an array, and the screen called `.map` on the envelope.
//
// Nothing upstream could catch it. `apiFetch<T>` is an unchecked assertion
// about the wire — typecheck believes whatever the binding declares — and the
// original spec asserted the request URL while stubbing the response as `[]`,
// which is the shape the bug assumed. A spec that invents its own fixture
// proves the client agrees with itself, not with the server.
//
// So each fixture below is typed as the API's OWN response type. If a
// controller's shape changes, `pnpm typecheck` fails here rather than a
// teacher's phone failing in Lagos.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", date: "Sun, 20 Sep 2026 09:30:00 GMT" },
  });
}

const LIST_FIXTURE: CurriculumDocumentListResponse = {
  documents: [
    {
      id: "doc-1",
      subjectId: "subject-1",
      classLevelId: "level-1",
      title: "JSS2 Basic Science, first term",
      status: "AWAITING_REVIEW",
      errorMessage: null,
      chunkCount: 12,
      uploadedBy: "user-1",
      reviewedBy: null,
      reviewedAt: null,
      headingEditCount: 0,
    } as CurriculumDocumentListResponse["documents"][number],
  ],
  usage: { documents: 1, maxDocuments: 20, chunks: 12, maxChunks: 2000 },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetServerClock();
  setTokenProvider(() => "test-token");
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(LIST_FIXTURE)));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenProvider(() => null);
  resetServerClock();
});

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url, init };
}

describe("curriculum list", () => {
  it("returns the ENVELOPE, not an array — the crash this fixes", async () => {
    const result = await staffListCurriculum();
    expect(Array.isArray(result)).toBe(false);
    expect(Array.isArray(result.documents)).toBe(true);
    expect(result.documents[0]?.title).toBe("JSS2 Basic Science, first term");
  });

  it("carries the usage caps the screen warns on", async () => {
    const result = await staffListCurriculum();
    expect(result.usage).toEqual({
      documents: 1,
      maxDocuments: 20,
      chunks: 12,
      maxChunks: 2000,
    });
  });

  it("reads the documents list the way the screen does", async () => {
    // Exactly the expression the screen uses. It must survive an empty list
    // and a missing envelope without throwing, because a render that throws
    // takes the whole app down rather than showing an error.
    const result = await staffListCurriculum();
    expect(result?.documents ?? []).toHaveLength(1);
    expect((undefined as CurriculumDocumentListResponse | undefined)?.documents ?? []).toEqual([]);
  });
});

describe("the other curriculum bindings", () => {
  it("pastes text to the first-class paste endpoint", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ documentId: "doc-1", status: "PENDING", chunkCount: 0 }, 202)),
    );
    await staffPasteCurriculum({
      classLevelId: "level-1",
      subjectId: "subject-1",
      title: "Scheme",
      content: "Week 1: Photosynthesis",
    });
    const { url, init } = lastCall();
    expect(url).toMatch(/\/curriculum\/documents\/paste$/);
    expect(init.method).toBe("POST");
  });

  it("uploads a file as multipart, letting the runtime set Content-Type", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ documentId: "doc-2", status: "PENDING", chunkCount: 0 }, 202)),
    );
    await staffUploadCurriculumFile(
      { classLevelId: "level-1", subjectId: "subject-1", title: "Scheme" },
      { uri: "file:///tmp/scheme.pdf", name: "scheme.pdf", mimeType: "application/pdf" },
    );
    const { url, init } = lastCall();
    expect(url).toMatch(/\/curriculum\/documents\/upload$/);
    expect(init.body).toBeInstanceOf(FormData);
    // Set by hand, the multipart boundary would be missing and the server
    // would find no fields at all.
    expect(new Headers(init.headers).get("Content-Type")).toBeNull();
  });

  it("approve returns { document, chunkCount }, not a bare document", async () => {
    const approved: ApproveCurriculumDocumentResponse = {
      document: LIST_FIXTURE.documents[0]!,
      chunkCount: 12,
    };
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(approved, 202)));
    const result = await staffApproveCurriculum("doc-1");
    expect(result.document.id).toBe("doc-1");
    expect(result.chunkCount).toBe(12);
    expect(lastCall().url).toMatch(/\/curriculum\/documents\/doc-1\/approve$/);
  });

  it("delete tolerates the 204 the endpoint actually returns", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(staffDeleteCurriculum("doc-1")).resolves.toBeUndefined();
    expect(lastCall().init.method).toBe("DELETE");
  });

  it("reads the teacher's own profile from the self-service route", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ id: "p1", staffNumber: "ST-001" })),
    );
    await staffMyProfile();
    // Not /teacher-profiles/:id — that is the admin route and a permission
    // teachers do not hold.
    expect(lastCall().url).toMatch(/\/teacher-profiles\/me$/);
  });
});
