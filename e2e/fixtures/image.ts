// Minimal valid image fixtures for upload tests (visual/UX overhaul
// initiative — real logo upload, 2026-07-26). Generated inline rather than
// checked in as a binary file, same convention as csv.ts's programmatic CSV
// content — no static fixture file to keep in sync.

// The smallest possible valid PNG: an 8-byte magic number is enough for the
// API's mimetype-whitelist check (it validates the declared Content-Type of
// the multipart part, not the file's actual pixel data), which is all these
// upload-path e2e tests need to exercise.
export const TINY_PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
