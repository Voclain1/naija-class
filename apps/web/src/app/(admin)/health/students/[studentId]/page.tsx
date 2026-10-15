"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { HealthProfileDto } from "@school-kit/types";

import { HealthProfilePanel } from "@/components/health/health-profile-panel";

// Phase 9 / CP3.1 — one child's health record, reached from the Health page.
export default function HealthStudentPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const [title, setTitle] = useState<{ name: string; sub: string } | null>(null);

  // Named from the panel's own read, so one visit is one audited read.
  const onLoaded = useCallback(
    (p: HealthProfileDto) => setTitle({ name: p.studentName, sub: `${p.admissionNumber}${p.className ? ` · ${p.className}` : ""}` }),
    [],
  );

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Link href="/health" className="text-sm text-primary hover:underline">
          ← Health
        </Link>
      </div>
      <header className="flex flex-col gap-1">
        <h1 className="break-words font-serif text-2xl font-medium tracking-tight text-foreground">
          {title?.name ?? "Health record"}
        </h1>
        {title && <p className="text-sm text-muted-foreground">{title.sub}</p>}
      </header>
      <HealthProfilePanel studentId={studentId} onLoaded={onLoaded} />
    </div>
  );
}
