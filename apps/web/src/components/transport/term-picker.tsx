"use client";

import { useEffect, useState } from "react";

import type { AcademicYearDto, TermDto } from "@school-kit/types";

import { Label } from "@/components/ui/label";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { currentSuffix, unambiguousCurrent } from "@/lib/finance/current-context";

export const SELECT_CLASSES =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:w-auto";

/**
 * Year and term pickers for the transport pages. Like the finance screens
 * (lib/finance/current-context.ts), the year defaults to the current one and
 * the TERM is never chosen for the user: putting a child on a route raises a
 * charge for that term, so the term is picked, with the current one labelled.
 */
export function useTermPicker() {
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [yearId, setYearId] = useState("");
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [termId, setTermId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAcademicYears()
      .then((y) => {
        setYears(y);
        const current = unambiguousCurrent(y);
        if (current) setYearId(current.id);
      })
      .catch(() => setError("Could not load the school's terms."));
  }, []);

  useEffect(() => {
    setTermId("");
    setTerms([]);
    if (!yearId) return;
    listTerms(yearId)
      .then(setTerms)
      .catch(() => setError("Could not load the school's terms."));
  }, [yearId]);

  return { years, yearId, setYearId, terms, termId, setTermId, error };
}

export function TermPicker({ picker, idPrefix }: { picker: ReturnType<typeof useTermPicker>; idPrefix: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-year`}>Academic year</Label>
        <select id={`${idPrefix}-year`} className={SELECT_CLASSES} value={picker.yearId} onChange={(e) => picker.setYearId(e.target.value)}>
          <option value="">Choose a year</option>
          {picker.years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.label}
              {currentSuffix(y.isCurrent)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-term`}>Term</Label>
        <select
          id={`${idPrefix}-term`}
          className={SELECT_CLASSES}
          value={picker.termId}
          disabled={!picker.yearId}
          onChange={(e) => picker.setTermId(e.target.value)}
        >
          <option value="">Choose a term</option>
          {picker.terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {currentSuffix(t.isCurrent)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
