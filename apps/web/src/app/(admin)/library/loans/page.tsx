"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatKobo, type LibraryLoanDto } from "@school-kit/types";

import { dueText, formatDay, LibraryHeader, message } from "@/components/library/library-shared";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ListExportMenu } from "@/components/shared/list-export-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import type { CsvColumn } from "@/lib/csv-export";
import { listLoans, markFound, renewLoan } from "@/lib/library/library-api";

// Phase 9 / CP6.1 — loans: books out now, the overdue ones, and those
// returned (docs/modules/phase-9.md §14 CP6-D2). "Overdue" and the days late
// are worked out by the API against today's date in Lagos. CP6.2: the fine so
// far on a late student loan (an estimate, by the rule the return applies),
// the fine or replacement price on a closed one, and lost books, which can be
// marked found.

type State = "OPEN" | "OVERDUE" | "RETURNED" | "LOST";
const STATES: { value: State; label: string }[] = [
  { value: "OPEN", label: "Out now" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "RETURNED", label: "Returned" },
  { value: "LOST", label: "Lost" },
];

/** The money on a loan, in words: an estimate while open, the figure once closed. */
function moneyText(l: LibraryLoanDto): string | null {
  if (!l.returnedAt && !l.lostAt) return l.fineSoFar ? `Fine so far ${formatKobo(l.fineSoFar)} (estimate)` : null;
  if (!l.fineAmount) return null;
  const what = l.lostAt ? "Replacement price" : "Fine";
  return l.fineWaivedReason ? `${what} ${formatKobo(l.fineAmount)} waived: ${l.fineWaivedReason}` : `${what} ${formatKobo(l.fineAmount)} charged`;
}

const COLUMNS: CsvColumn<LibraryLoanDto>[] = [
  { header: "Title", accessor: (l) => l.title },
  { header: "Copy", accessor: (l) => l.accessionNumber },
  { header: "Borrower", accessor: (l) => l.borrower.name },
  { header: "Class", accessor: (l) => l.borrower.detail },
  { header: "Due", accessor: (l) => formatDay(l.dueOn) },
  { header: "Days late", accessor: (l) => String(l.daysLate) },
  { header: "Returned", accessor: (l) => (l.returnedAt ? formatDay(l.returnedAt) : l.lostAt ? `Lost ${formatDay(l.lostAt)}` : "") },
  { header: "Fine", accessor: (l) => moneyText(l) ?? "" },
];

export default function LibraryLoansPage() {
  const { permissions } = useAuth();
  const canLend = hasPermission(permissions, "library.lend");
  const [state, setState] = useState<State>("OPEN");
  const [q, setQ] = useState("");
  const [loans, setLoans] = useState<LibraryLoanDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (s: State, search: string) => {
    setError(null);
    try {
      setLoans(await listLoans(s, search.trim() || undefined));
    } catch (e) {
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    // The search box is applied on submit only.
    void load(state, "");
  }, [load, state]);

  const label = STATES.find((s) => s.value === state)!.label;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <LibraryHeader title="Loans" intro="Books out now, the overdue ones, the most recent returns, and lost books." />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Which loans">
        {STATES.map((s) => (
          <Button key={s.value} size="sm" variant={state === s.value ? "default" : "outline"} aria-pressed={state === s.value} onClick={() => setState(s.value)}>
            {s.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <form
          className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void load(state, q);
          }}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="loans-search">Search loans</Label>
            <Input id="loans-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, copy number or borrower" />
          </div>
          <Button type="submit" variant="outline">
            Look up
          </Button>
        </form>
        {loans && loans.length > 0 && (
          <ListExportMenu title={`Library loans — ${label}`} csvFilename={`library-loans-${state.toLowerCase()}.csv`} columns={COLUMNS} getRows={() => loans} />
        )}
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}
      {notice && <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">{notice}</p>}

      {!loans ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : loans.length === 0 ? (
        <p className="text-sm text-muted-foreground">{state === "OVERDUE" ? "No books are overdue." : state === "LOST" ? "No books are lost." : "No loans to show."}</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {loans.map((l) => (
            <li key={l.id} className={`flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between ${l.overdue ? "bg-amber-500/10" : ""}`}>
              <div className="min-w-0 space-y-0.5">
                <Link href={`/library/books/${l.bookId}`} className="break-words font-medium text-primary underline-offset-2 hover:underline">
                  {l.title}
                </Link>
                <p className="break-words text-muted-foreground">
                  No. {l.accessionNumber} · {l.borrower.name} ({l.borrower.detail})
                </p>
                <p className={l.overdue ? "font-medium text-amber-900 dark:text-amber-200" : ""}>
                  {l.lostAt ? `Lost ${formatDay(l.lostAt)}${l.foundAt ? `, found ${formatDay(l.foundAt)}` : ""}` : dueText(l)}
                </p>
                {moneyText(l) && <p className="text-muted-foreground">{moneyText(l)}</p>}
              </div>
              {canLend && l.lostAt && !l.foundAt && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Found ${l.title}`}
                  onClick={async () => {
                    try {
                      const { charge } = await markFound(l.id);
                      setNotice(
                        charge === "voided"
                          ? "Back on the shelf. The replacement charge was cancelled."
                          : charge === "billed"
                            ? "Back on the shelf. The replacement charge is already on an invoice; any refund is for the bursar."
                            : "Back on the shelf.",
                      );
                      await load(state, q);
                    } catch (e) {
                      setError(message(e));
                    }
                  }}
                >
                  Found it
                </Button>
              )}
              {canLend && !l.returnedAt && !l.overdue && l.renewalsLeft > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Renew ${l.title} for ${l.borrower.name}`}
                  onClick={async () => {
                    try {
                      await renewLoan(l.id);
                      await load(state, q);
                    } catch (e) {
                      setError(message(e));
                    }
                  }}
                >
                  Renew
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
