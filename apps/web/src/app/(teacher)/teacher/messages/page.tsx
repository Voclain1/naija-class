"use client";

import { InboxList } from "@/components/messages/inbox-list";

// Phase 9 / CP8.1 — private messages from parents (docs/modules/phase-9.md §17.8).
export default function MessagesPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-semibold">Messages</h1>
        <p className="text-sm text-muted-foreground">Conversations parents have addressed or passed to you. Nobody else at the school can see them.</p>
      </div>
      <InboxList basePath="/teacher/messages" />
    </div>
  );
}
