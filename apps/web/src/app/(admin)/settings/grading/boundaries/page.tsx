"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { GradeBoundaryDto } from "@school-kit/types";

import { BoundariesEditor } from "@/components/settings/grading/boundaries-editor";
import { ApiError } from "@/lib/api-client";
import { listBoundaries } from "@/lib/grading/grading-api";

// /settings/grading/boundaries — the letter-grade scale. Defaults to the WAEC
// scale at signup. The grid edits each band; Save bulk-replaces the whole set,
// which must tile 0–100 with no gaps or overlaps (re-checked server-side).
export default function GradeBoundariesPage() {
  const [boundaries, setBoundaries] = useState<GradeBoundaryDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBoundaries(await listBoundaries());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load grade boundaries.");
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
        <h1 className="text-2xl font-semibold tracking-tight">Grade boundaries</h1>
        <p className="text-sm text-muted-foreground">
          Map total scores to letter grades. The bands must cover 0–100 with no
          gaps or overlaps. The default is the WAEC nine-point scale — edit it to
          match your school&apos;s grading.
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
      ) : boundaries ? (
        <BoundariesEditor
          key={boundaries.map((b) => b.id).join(",")}
          boundaries={boundaries}
        />
      ) : null}
    </div>
  );
}
