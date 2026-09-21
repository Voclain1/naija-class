import type { CurriculumUploadAcceptedResponse } from "@school-kit/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The native module cannot load under Node, so it is replaced wholesale.
// `uploadAsync` is the real function's name and signature; the enum value is
// the real one's string.
const uploadAsync = vi.fn();
vi.mock("expo-file-system/legacy", () => ({
  uploadAsync: (...args: unknown[]) => uploadAsync(...args),
  FileSystemUploadType: { MULTIPART: 1, BINARY_CONTENT: 0 },
}));

import { ApiError, ApiNetworkError, onUnauthorized, setTokenProvider } from "./client";
import { uploadFailureDetail, uploadMultipart } from "./native-upload";
import { staffUploadCurriculumFile } from "./staff-curriculum";
import { resetServerClock, serverToday } from "../staff/server-date";

// The first device build could not upload a curriculum file at all: every
// attempt said "couldn't reach the server" while the live API answered every
// curriculum route. The fetch + FormData path was failing on the handset, and
// the reason was thrown away. These pin the replacement: the native uploader,
// the exact form the controller reads, errors interpreted like any other
// request, and the native reason KEPT.

const ACCEPTED: CurriculumUploadAcceptedResponse = {
  documentId: "doc-1",
  status: "PENDING",
  chunkCount: 0,
} as CurriculumUploadAcceptedResponse;

function nativeResult(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { date: "Mon, 21 Sep 2026 09:30:00 GMT", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
    mimeType: "application/json",
  };
}

beforeEach(() => {
  resetServerClock();
  setTokenProvider(() => "test-token");
  uploadAsync.mockReset();
});

afterEach(() => {
  setTokenProvider(() => null);
  resetServerClock();
});

describe("curriculum file upload", () => {
  it("goes through the native uploader as multipart, with the fields the controller reads", async () => {
    uploadAsync.mockResolvedValue(nativeResult(202, ACCEPTED));

    await staffUploadCurriculumFile(
      { subjectId: "subject-1", classLevelId: "level-1", title: "JSS2 Basic Science" },
      { uri: "file:///cache/scheme.pdf", name: "scheme.pdf", mimeType: "application/pdf" },
    );

    const [url, fileUri, options] = uploadAsync.mock.calls.at(-1) as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(url).toMatch(/\/curriculum\/documents\/upload$/);
    expect(fileUri).toBe("file:///cache/scheme.pdf");
    expect(options.httpMethod).toBe("POST");
    expect(options.uploadType).toBe(1); // MULTIPART, not BINARY_CONTENT
    // FileInterceptor("file") on the server: any other name and it finds no file.
    expect(options.fieldName).toBe("file");
    expect(options.mimeType).toBe("application/pdf");
    expect(options.parameters).toEqual({
      subjectId: "subject-1",
      classLevelId: "level-1",
      title: "JSS2 Basic Science",
    });
  });

  it("sends the bearer token, because it bypasses apiFetch", async () => {
    uploadAsync.mockResolvedValue(nativeResult(202, ACCEPTED));
    await uploadMultipart("/x", {
      fileUri: "file:///a.pdf",
      fieldName: "file",
      mimeType: "application/pdf",
      parameters: {},
    });
    const options = uploadAsync.mock.calls.at(-1)?.[2] as { headers: Record<string, string> };
    expect(options.headers.Authorization).toBe("Bearer test-token");
  });

  it("sends no Authorization header at all when signed out", async () => {
    setTokenProvider(() => null);
    uploadAsync.mockResolvedValue(nativeResult(202, ACCEPTED));
    await uploadMultipart("/x", {
      fileUri: "file:///a.pdf",
      fieldName: "file",
      mimeType: "application/pdf",
      parameters: {},
    });
    const options = uploadAsync.mock.calls.at(-1)?.[2] as { headers: Record<string, string> };
    expect(options.headers.Authorization).toBeUndefined();
  });

  it("returns the server's receipt on success", async () => {
    uploadAsync.mockResolvedValue(nativeResult(202, ACCEPTED));
    const result = await staffUploadCurriculumFile(
      { subjectId: "s", classLevelId: "l", title: "t" },
      { uri: "file:///a.pdf", name: "a.pdf", mimeType: "application/pdf" },
    );
    expect(result.documentId).toBe("doc-1");
  });

  it("records the server's clock from the response, like any other request", async () => {
    uploadAsync.mockResolvedValue(nativeResult(202, ACCEPTED));
    await uploadMultipart("/x", {
      fileUri: "file:///a.pdf",
      fieldName: "file",
      mimeType: "application/pdf",
      parameters: {},
    });
    expect(serverToday()).toBe("2026-09-21");
  });
});

describe("upload failures", () => {
  it("keeps the NATIVE reason, instead of discarding it as the old path did", async () => {
    uploadAsync.mockRejectedValue(new Error("open failed: ENOENT (No such file or directory)"));
    const error = await uploadMultipart("/x", {
      fileUri: "file:///gone.pdf",
      fieldName: "file",
      mimeType: "application/pdf",
      parameters: {},
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiNetworkError);
    // This is what lets a repeat failure be diagnosed from a screenshot.
    expect(uploadFailureDetail(error)).toBe("open failed: ENOENT (No such file or directory)");
  });

  it("reports a server refusal as an ApiError with its code, not a network failure", async () => {
    uploadAsync.mockResolvedValue(
      nativeResult(413, { error: { code: "FILE_TOO_LARGE", message: "Max 10 MB." } }),
    );
    const error = await uploadMultipart("/x", {
      fileUri: "file:///big.pdf",
      fieldName: "file",
      mimeType: "application/pdf",
      parameters: {},
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("FILE_TOO_LARGE");
    expect((error as ApiError).status).toBe(413);
  });

  it("ends the session on a 401, exactly as apiFetch does", async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    uploadAsync.mockResolvedValue(
      nativeResult(401, { error: { code: "SESSION_EXPIRED", message: "Expired." } }),
    );

    await uploadMultipart("/x", {
      fileUri: "file:///a.pdf",
      fieldName: "file",
      mimeType: "application/pdf",
      parameters: {},
    }).catch(() => undefined);

    // One interpreter for every request: an expired session is torn down the
    // same way whether it surfaced on an upload or anywhere else.
    expect(listener).toHaveBeenCalledWith("SESSION_EXPIRED");
    unsubscribe();
  });

  it("has no detail to show when there is no underlying cause", () => {
    expect(uploadFailureDetail(new ApiNetworkError())).toBeNull();
    expect(uploadFailureDetail(null)).toBeNull();
  });
});
