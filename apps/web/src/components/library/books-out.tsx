"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { LibraryBorrowerLoansDto } from "@school-kit/types";

import { dueText } from "@/components/library/library-shared";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { getStaffLoans, getStudentLoans } from "@/lib/library/library-api";

// Phase 9 / CP6.1 — the library books a student or member of staff has out,
// on their page. Shown only to those who hold library.read.
export function BooksOutField({ kind, id }: { kind: "STUDENT" | "STAFF"; id: string }) {
  const { permissions } = useAuth();
  const allowed = hasPermission(permissions, "library.read");
  const [state, setState] = useState<{ loaded: boolean; value: LibraryBorrowerLoansDto | null }>({ loaded: false, value: null });

  useEffect(() => {
    if (!allowed) return;
    (kind === "STUDENT" ? getStudentLoans(id) : getStaffLoans(id))
      .then((value) => setState({ loaded: true, value }))
      .catch(() => setState({ loaded: true, value: null }));
  }, [allowed, kind, id]);

  if (!allowed) return null;
  const loans = state.value?.loans ?? [];
  return (
    <div className="flex flex-col gap-0.5 sm:col-span-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Library books out</dt>
      <dd>
        {!state.loaded ? (
          "…"
        ) : loans.length === 0 ? (
          "None"
        ) : (
          <ul className="space-y-0.5">
            {loans.map((l) => (
              <li key={l.id} className={l.overdue ? "rounded bg-amber-500/10 px-2 py-0.5" : ""}>
                <Link href={`/library/books/${l.bookId}`} className="text-primary underline-offset-2 hover:underline">
                  {l.title}
                </Link>{" "}
                · {dueText(l)}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
