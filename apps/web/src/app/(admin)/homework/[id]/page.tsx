"use client";

import { useParams } from "next/navigation";

import { MarkingView } from "@/components/assignments/marking-view";

// Phase 9 / CP4.1 — owner and admin look at, and may mark, a class's handed-in
// work. The bursar reaches the homework list but not this (assignment.read).
export default function HomeworkWorkPage() {
  const { id } = useParams<{ id: string }>();
  return <MarkingView homeworkId={id} backHref="/homework" backLabel="Homework" />;
}
