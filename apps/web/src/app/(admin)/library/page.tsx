"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { LibraryBookSummaryDto, LibraryContextDto } from "@school-kit/types";

import { BookForm } from "@/components/library/book-form";
import { LibraryHeader, message } from "@/components/library/library-shared";
import { InlineAlert } from "@/components/shared/inline-alert";
import { SELECT_CLASSES } from "@/components/transport/term-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { createBook, getLibraryContext, listBooks } from "@/lib/library/library-api";

// Phase 9 / CP6.1 — the library catalogue (docs/modules/phase-9.md §14 CP6-D1).
// Search by title, author, ISBN or a copy's accession number; add a book with
// its copies. Every count is the API's.

export default function LibraryPage() {
  const router = useRouter();
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "library.manage");
  const [context, setContext] = useState<LibraryContextDto | null>(null);
  const [books, setBooks] = useState<LibraryBookSummaryDto[] | null>(null);
  const [q, setQ] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (search: string, subject: string) => {
    setError(null);
    try {
      setBooks(await listBooks({ q: search.trim() || undefined, subjectId: subject || undefined }));
    } catch (e) {
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    getLibraryContext().then(setContext).catch((e) => setError(message(e)));
    void load("", "");
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <LibraryHeader title="Library" intro="The school's books and their copies. Each copy has its own accession number, written on its label." />

      {error && <InlineAlert>{error}</InlineAlert>}

      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void load(q, subjectId);
        }}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="catalogue-search">Search the catalogue</Label>
          <Input id="catalogue-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, author, ISBN or accession number" />
        </div>
        {context && context.subjects.length > 0 && (
          <div className="space-y-1">
            <Label htmlFor="catalogue-subject">Subject</Label>
            <select
              id="catalogue-subject"
              className={SELECT_CLASSES}
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                void load(q, e.target.value);
              }}
            >
              <option value="">All subjects</option>
              {context.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button type="submit" variant="outline">
          Look up
        </Button>
      </form>

      {canManage && context && (
        <section className="rounded-md border bg-card p-4">
          {adding ? (
            <div className="space-y-3">
              <h2 className="font-medium">Add a book</h2>
              <BookForm
                context={context}
                withCopies
                submitLabel="Save book"
                onCancel={() => setAdding(false)}
                onSubmit={async (fields, copies) => {
                  const book = await createBook({ ...fields, ...(copies ? { copies } : {}) });
                  router.push(`/library/books/${book.id}`);
                }}
              />
            </div>
          ) : (
            <Button onClick={() => setAdding(true)}>Add a book</Button>
          )}
        </section>
      )}

      {!books ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : books.length === 0 ? (
        <p className="text-sm text-muted-foreground">No books found.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {books.map((b) => (
            <li key={b.id} className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-0.5">
                <Link href={`/library/books/${b.id}`} className="break-words font-medium text-primary underline-offset-2 hover:underline">
                  {b.title}
                </Link>
                <p className="break-words text-muted-foreground">
                  {[b.authors, b.subjectName, b.shelfLocation].filter(Boolean).join(" · ") || "No details yet"}
                </p>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                {b.referenceOnly ? (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">Reference only</span>
                ) : (
                  <span className={b.copies > 0 && b.available === 0 ? "rounded bg-amber-500/10 px-2 py-0.5 text-amber-900 dark:text-amber-200" : ""}>
                    {b.available} of {b.copies} on the shelf
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
