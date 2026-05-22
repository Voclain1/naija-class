"use client";

import { ArrowLeft, CalendarPlus, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { AcademicYearDto, TermDto } from "@school-kit/types";

import { TermDialog } from "@/components/settings/academic/term-dialog";
import { TermsTable } from "@/components/settings/academic/terms-table";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  deleteTerm,
  getAcademicYear,
  listTerms,
  setCurrentTerm,
} from "@/lib/academic-years/academic-years-api";

// /settings/academic/years/[id]/terms — manages the three terms of a year.
// Loads the parent year alongside its terms so the heading + dates are
// available immediately. Add-term is hidden when 3 terms exist.
//
// Note on setCurrentTerm: the server cascades the flag to the parent year.
// We don't refetch the year row here (it's local-only for display), but a
// browser refresh — or going back to /settings/academic/years — will show
// the year flipped to Current. This is the cascade invariant the
// terms.service spec asserts.
export default function YearTermsPage() {
  const params = useParams<{ id: string }>();
  const academicYearId = params.id;

  const [year, setYear] = useState<AcademicYearDto | null>(null);
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TermDto | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [y, t] = await Promise.all([
        getAcademicYear(academicYearId),
        listTerms(academicYearId),
      ]);
      setYear(y);
      setTerms(t);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load terms.");
    } finally {
      setLoading(false);
    }
  }, [academicYearId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaved = useCallback((saved: TermDto) => {
    setTerms((prev) => {
      const existing = prev.findIndex((t) => t.id === saved.id);
      if (existing === -1)
        return [...prev, saved].sort((a, b) => a.sequence - b.sequence);
      const next = [...prev];
      next[existing] = saved;
      return next.sort((a, b) => a.sequence - b.sequence);
    });
  }, []);

  const onSetCurrent = useCallback(async (target: TermDto) => {
    try {
      const updated = await setCurrentTerm(target.id);
      setTerms((prev) =>
        prev.map((t) =>
          t.id === updated.id
            ? updated
            : t.isCurrent
              ? { ...t, isCurrent: false }
              : t,
        ),
      );
      // The server also flipped the parent year to current. Reflect it
      // locally so the breadcrumb tells the truth without a refresh.
      setYear((prev) => (prev ? { ...prev, isCurrent: true } : prev));
      toast.success(
        `"${updated.name}" is now the current term. The year was set current too.`,
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not set current term.");
    }
  }, []);

  const onDelete = useCallback(async (target: TermDto) => {
    if (!window.confirm(`Delete "${target.name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteTerm(target.id);
      setTerms((prev) => prev.filter((t) => t.id !== target.id));
      toast.success("Term deleted.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete term.");
    }
  }, []);

  // Pre-compute next sequence (1/2/3) so the dialog opens with a sensible
  // default. If all three exist we hide the add button anyway.
  const nextSequence = (() => {
    const taken = new Set(terms.map((t) => t.sequence));
    for (const s of [1, 2, 3]) if (!taken.has(s)) return s;
    return 1;
  })();

  const canAdd = terms.length < 3;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <Link
        href="/settings/academic/years"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to academic years
      </Link>

      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Terms{year ? ` — ${year.label}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            A Nigerian academic year is three terms. Setting a term as current
            also marks its parent year as the school&apos;s current year.
          </p>
        </div>
        {canAdd && (
          <Button
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <CalendarPlus className="mr-1 h-4 w-4" />
            Add term
          </Button>
        )}
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
      ) : (
        <TermsTable
          terms={terms}
          onEdit={(t) => {
            setEditing(t);
            setDialogOpen(true);
          }}
          onSetCurrent={onSetCurrent}
          onDelete={onDelete}
        />
      )}

      <TermDialog
        open={dialogOpen}
        academicYearId={academicYearId}
        suggestedSequence={nextSequence}
        existing={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={onSaved}
      />
    </div>
  );
}
