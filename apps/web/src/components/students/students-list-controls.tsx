"use client";

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { ClassArmDto, StudentStatusDto } from "@school-kit/types";

import { Input } from "@/components/ui/input";

interface Props {
  search: string;
  status: StudentStatusDto | "";
  classArmId: string;
  arms: ClassArmDto[];
  onSearchChange: (next: string) => void;
  onStatusChange: (next: StudentStatusDto | "") => void;
  onClassArmChange: (next: string) => void;
}

// Debounced search box (300ms) — keystrokes update local state immediately;
// the parent's `onSearchChange` only fires once typing settles. Status +
// class-arm dropdowns are non-debounced (single click).
//
// Slice 9: class-arm filter joins through CURRENT-term enrollment; an arm
// with no current-term enrollments simply yields an empty result.
export function StudentsListControls({
  search,
  status,
  classArmId,
  arms,
  onSearchChange,
  onStatusChange,
  onClassArmChange,
}: Props) {
  const [draft, setDraft] = useState(search);

  // Keep the local draft in sync if the parent resets the search externally.
  useEffect(() => {
    setDraft(search);
  }, [search]);

  useEffect(() => {
    if (draft === search) return;
    const handle = window.setTimeout(() => onSearchChange(draft), 300);
    return () => window.clearTimeout(handle);
  }, [draft, search, onSearchChange]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search by name or admission number…"
          className="pl-9 pr-9"
          aria-label="Search students"
        />
        {draft && (
          <button
            type="button"
            onClick={() => setDraft("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <select
        className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-48"
        value={status}
        onChange={(e) =>
          onStatusChange(e.target.value as StudentStatusDto | "")
        }
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        <option value="ACTIVE">Active</option>
        <option value="INACTIVE">Inactive</option>
        <option value="SUSPENDED">Suspended</option>
        <option value="WITHDRAWN">Withdrawn</option>
        <option value="GRADUATED">Graduated</option>
      </select>
      <select
        className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-48"
        value={classArmId}
        onChange={(e) => onClassArmChange(e.target.value)}
        aria-label="Filter by current class arm"
      >
        <option value="">All classes</option>
        {arms.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
