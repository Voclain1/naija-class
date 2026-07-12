import { NextResponse } from "next/server";

// Mirrors apps/api's own GET /health philosophy — a dedicated route the
// smoke test (scripts/smoke-test.sh Op 6, phase-4.md §7 D7) can assert
// against, cleaner than sniffing homepage HTML.
export function GET() {
  return NextResponse.json({ status: "ok" });
}
