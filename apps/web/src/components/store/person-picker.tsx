"use client";

import { Loader2, Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import type { StorePersonDto } from "@school-kit/types";

import { findStorePeople } from "@/lib/store/store-api";

// Finds a student or a member of staff by name or admission number, for
// issuing and selling. Searches after the third letter.
export function PersonPicker({
  kind,
  label,
  value,
  onChange,
}: {
  kind: "STUDENT" | "STAFF";
  label: string;
  value: StorePersonDto | null;
  onChange: (person: StorePersonDto | null) => void;
}) {
  const inputId = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StorePersonDto[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (value || term.length < 3) {
      setResults([]);
      return;
    }
    let live = true;
    setBusy(true);
    const t = window.setTimeout(() => {
      findStorePeople(kind, term)
        .then((r) => live && setResults(r))
        .catch(() => live && setResults([]))
        .finally(() => live && setBusy(false));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q, kind, value]);

  if (value) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span>
            <span className="font-medium">{value.name}</span>
            {value.detail ? <span className="text-muted-foreground"> · {value.detail}</span> : null}
          </span>
          <button type="button" onClick={() => onChange(null)} aria-label={`Clear ${label.toLowerCase()}`} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id={inputId}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={kind === "STUDENT" ? "Name or admission number" : "Name"}
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm"
          autoComplete="off"
        />
        {busy && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      {results.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-md border bg-card text-sm" role="listbox" aria-label={`${label} results`}>
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onChange(p);
                  setQ("");
                }}
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-accent"
              >
                <span className="font-medium">{p.name}</span>
                {p.detail ? <span className="text-xs text-muted-foreground">{p.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 3 && !busy && results.length === 0 && (
        <p className="text-xs text-muted-foreground">No one matches “{q.trim()}”.</p>
      )}
    </div>
  );
}
