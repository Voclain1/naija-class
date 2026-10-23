"use client";

import { useState } from "react";

// "Report this photo" (docs/modules/school-website.md W4): anyone can flag a
// photo or post to SchoolKit, which can take it down. Nothing about the
// reporter is kept; the API limits how often one address can report.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export function ReportButton({ code, target, label = "Report this photo" }: { code: string; target: { photoId: string } | { postId: string }; label?: string }) {
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");

  async function report() {
    const reason = window.prompt("What is wrong with it? For example: it shows pupils. SchoolKit will look at it.");
    if (!reason || reason.trim().length < 3) return;
    try {
      const res = await fetch(`${API_BASE}/school-addresses/${encodeURIComponent(code)}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, reason: reason.trim().slice(0, 500) }),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") return <span className="text-xs text-muted-foreground">Thank you. SchoolKit will look at it.</span>;
  return (
    <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => void report()}>
      {state === "error" ? "Couldn't send. Try again" : label}
    </button>
  );
}
