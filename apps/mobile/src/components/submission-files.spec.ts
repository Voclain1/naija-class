import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Alert: {}, Linking: {}, StyleSheet: { create: (s: unknown) => s }, View: "View" }));
vi.mock("./ui", () => ({ Button: "Button" }));
vi.mock("../lib/api/client", () => ({ ApiError: class extends Error {} }));

import { fileLabel } from "./submission-files";

// Phase 9 / CP4.2 — how each attached file is named on its button.
describe("fileLabel", () => {
  it("numbers files only when there is more than one of a kind", () => {
    const files = [
      { id: "a", type: "image" as const, size: 1 },
      { id: "b", type: "pdf" as const, size: 1 },
      { id: "c", type: "image" as const, size: 1 },
    ];
    expect(files.map((_, i) => fileLabel(files, i))).toEqual(["photo 1", "PDF", "photo 2"]);
  });
});
