"use client";

import { useEffect, useState } from "react";

import type { ClassArmDto, TermDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Label } from "@/components/ui/label";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { listClassLevels } from "@/lib/class-levels/class-levels-api";

// Place a student in a class while creating them (2026-09-07).
//
// WHY THIS EXISTS: creating a student did not put them in a class, and nothing
// downstream reads `Student` — the register, the arm invoice run, the teacher's
// roster and the report-card build all join through `Enrollment`. A school that
// added 400 students and stopped saw every class, register and invoice run come
// back empty, all of them "working correctly".
//
// THE ONE THING THIS MUST NOT DO IS GUESS. There is no pre-selected class. The
// 2026-08-25 carry-over incident was a pre-ticked default that enrolled every
// student at a newly-onboarded school into one arm, and the CSV import's own
// term default was overridden at review on the same reasoning: "a silent
// default is most dangerous exactly when it is most likely wrong". So the admin
// picks a class, or explicitly picks "not yet" — but the form will not answer
// for them.

export interface PlacementValue {
  termId: string;
  classArmId: string;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; terms: TermDto[]; arms: ArmOption[]; defaultTermId: string | null }
  /** Nothing to place INTO — no arms, or no calendar. Not an error. */
  | { kind: "unavailable"; reason: "no-arms" | "no-calendar" }
  | { kind: "error" };

interface ArmOption {
  id: string;
  label: string;
}

/**
 * First-time-friendly guidance for a school that has nothing to place into.
 *
 * Deliberately says what a class IS in this product before telling anyone to
 * go and make one. The empty state this replaces read "Use single enrollment
 * per student, or wait for a previous term to populate so you can carry over"
 * — three pieces of jargon and a reference to a screen it did not link to.
 */
export const NO_ARMS_TITLE = "You have no classes set up yet";
export const NO_ARMS_BODY =
  "A class is a group like JSS 1A that students belong to. Registers, results and " +
  "invoices are all built per class, so students need to be in one before those " +
  "screens show anything. You can add this student now and put them in a class later.";
export const NO_CALENDAR_TITLE = "Your school year isn't set up yet";
export const NO_CALENDAR_BODY =
  "Students are placed in a class for a particular term, so your school year and its " +
  "terms need to exist first. You can add this student now and place them later.";

export function PlacementPicker({
  value,
  onChange,
  onUnavailable,
  disabled,
}: {
  /** null means the admin explicitly chose "not yet". undefined means unanswered. */
  value: PlacementValue | null | undefined;
  onChange: (next: PlacementValue | null) => void;
  /**
   * Called when there is nothing to place INTO. The form gates submission on an
   * explicit answer, so it has to be told the question does not apply — see the
   * no-arms branch.
   */
  onUnavailable: () => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [arms, levels, years] = await Promise.all([
          listClassArms(),
          listClassLevels(),
          listAcademicYears(),
        ]);
        if (cancelled) return;

        const activeArms = arms.filter((a: ClassArmDto) => a.isActive);
        if (activeArms.length === 0) {
          setState({ kind: "unavailable", reason: "no-arms" });
          // Answer on the form's behalf. The form requires an explicit choice
          // before it will submit, and when there is nothing to choose from
          // that gate would otherwise block student creation entirely at a
          // brand-new school — the exact school this feature is meant to help.
          // Found by the no-arms browser test, which could not submit at all.
          onUnavailable();
          return;
        }

        // A year with terms is required — an Enrollment carries a termId.
        const currentYear = years.find((y) => y.isCurrent) ?? years[0];
        if (!currentYear) {
          setState({ kind: "unavailable", reason: "no-calendar" });
          onUnavailable();
          return;
        }
        const terms = await listTerms(currentYear.id);
        if (cancelled) return;
        if (terms.length === 0) {
          setState({ kind: "unavailable", reason: "no-calendar" });
          onUnavailable();
          return;
        }

        const levelName = new Map(levels.map((l) => [l.id, l.name]));
        const armOptions: ArmOption[] = activeArms
          .map((a) => ({
            id: a.id,
            // "JSS 1 — JSS 1A". Arm names are not unique school-wide (the
            // schema calls `name` renamable and only `code` is unique per
            // level), so the level prefix is what makes two arms both called
            // "A" distinguishable in a flat list.
            label: `${levelName.get(a.classLevelId) ?? "Class"} — ${a.name}`,
          }))
          .sort((x, y) => x.label.localeCompare(y.label));

        // The TERM may be pre-selected when exactly one is current — it is
        // shown, labelled, and changeable, which is what separates it from the
        // silent default that caused the carry-over incident. The CLASS never
        // is: that is the choice being asked for.
        const currentTerms = terms.filter((t) => t.isCurrent);
        setState({
          kind: "ready",
          terms,
          arms: armOptions,
          defaultTermId: currentTerms.length === 1 ? currentTerms[0]!.id : null,
        });
      } catch {
        if (cancelled) return;
        setState({ kind: "error" });
        // Same reasoning as the unavailable branches: a failed lookup must not
        // make the student form unusable.
        onUnavailable();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once. `onUnavailable` is intentionally not a dependency — the form
    // passes a fresh closure each render, and re-running this would re-fetch on
    // every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.kind === "loading") {
    return <p className="text-sm text-muted-foreground">Loading classes…</p>;
  }

  if (state.kind === "error") {
    return (
      <p className="text-sm text-muted-foreground">
        Classes could not be loaded, so this student will be added without one. You can put
        them in a class later from their student page.
      </p>
    );
  }

  if (state.kind === "unavailable") {
    const noArms = state.reason === "no-arms";
    return (
      <InlineAlert tone="warning" title={noArms ? NO_ARMS_TITLE : NO_CALENDAR_TITLE}>
        <p>{noArms ? NO_ARMS_BODY : NO_CALENDAR_BODY}</p>
      </InlineAlert>
    );
  }

  const termId = value?.termId ?? state.defaultTermId ?? "";
  const armId = value?.classArmId ?? "";
  const notYet = value === null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="placement-arm">Class</Label>
        <select
          id="placement-arm"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          disabled={disabled}
          value={notYet ? "__later__" : armId}
          onChange={(e) => {
            const next = e.target.value;
            if (next === "" ) {
              onChange(null);
              return;
            }
            if (next === "__later__") {
              onChange(null);
              return;
            }
            onChange({ termId: termId || state.terms[0]!.id, classArmId: next });
          }}
        >
          {/* No pre-selected class, deliberately — see the header. */}
          <option value="">Choose a class…</option>
          {state.arms.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          <option value="__later__">Not yet — I&apos;ll place them later</option>
        </select>
      </div>

      {!notYet && armId ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="placement-term">Term</Label>
          <select
            id="placement-term"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            disabled={disabled}
            value={termId}
            onChange={(e) => onChange({ termId: e.target.value, classArmId: armId })}
          >
            {state.terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isCurrent ? " (current term)" : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Students are placed in a class one term at a time. At the start of the next term
            you can move everyone forward in one step.
          </p>
        </div>
      ) : null}
    </div>
  );
}
