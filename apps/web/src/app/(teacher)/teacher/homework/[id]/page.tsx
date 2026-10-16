"use client";

import { useParams } from "next/navigation";

import { MarkingView } from "@/components/assignments/marking-view";

// Phase 9 / CP4.1 — the teacher marks what a class handed in for one homework item.
export default function TeacherHomeworkWorkPage() {
  const { id } = useParams<{ id: string }>();
  return <MarkingView homeworkId={id} backHref="/teacher/homework" backLabel="Homework" />;
}
