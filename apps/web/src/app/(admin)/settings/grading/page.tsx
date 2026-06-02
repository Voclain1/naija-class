"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { GradingSchemeDto } from "@school-kit/types";

import { SchemeEditor } from "@/components/settings/grading/scheme-editor";
import { ApiError } from "@/lib/api-client";
import { getGradingScheme } from "@/lib/grading/grading-api";

// /settings/grading — the component-weight scheme editor. Each school has
// exactly one scheme (seeded at signup); the grid edits its components, and
// Save bulk-replaces the whole set (weights must sum to 100, re-checked
// server-side).
export default function GradingSchemePage() {
  const [scheme, setScheme] = useState<GradingSchemeDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setScheme(await getGradingScheme());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the grading scheme.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Grading scheme</h1>
        <p className="text-sm text-muted-foreground">
          Define how each subject&apos;s term score is split across continuous
          assessment and exams. Weights must total exactly 100. This scheme
          applies to every subject in your school.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : scheme ? (
        // Remount when the persisted scheme identity changes so the form's
        // defaultValues re-seed from fresh server state.
        <SchemeEditor key={scheme.updatedAt.toString()} scheme={scheme} />
      ) : null}
    </div>
  );
}
