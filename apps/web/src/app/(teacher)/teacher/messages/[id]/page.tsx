"use client";

import { useParams } from "next/navigation";

import { ThreadView } from "@/components/messages/thread-view";

// Phase 9 / CP8.1 — one conversation (docs/modules/phase-9.md §17.8).
export default function MessageThreadPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="mx-auto max-w-3xl">
      <ThreadView id={id} backHref="/teacher/messages" />
    </div>
  );
}
