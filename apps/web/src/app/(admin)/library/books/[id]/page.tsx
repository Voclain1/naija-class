"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { formatKobo, type LibraryBookDto, type LibraryContextDto, type LibraryCopyDto } from "@school-kit/types";

import { BookForm, CopiesFields } from "@/components/library/book-form";
import { COPY_STATUS_LABEL, dueText, LibraryNav, message } from "@/components/library/library-shared";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { addCopies, deleteBook, getBook, getLibraryContext, updateBook, updateCopy } from "@/lib/library/library-api";

// Phase 9 / CP6.1 — one book: its details, its copies and who has each one out
// (docs/modules/phase-9.md §14 CP6-D1). A copy on loan cannot be withdrawn; a
// book that has ever been lent cannot be deleted, only its copies withdrawn.

export default function LibraryBookPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "library.manage");
  const [book, setBook] = useState<LibraryBookDto | null>(null);
  const [context, setContext] = useState<LibraryContextDto | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBook(await getBook(id));
    } catch (e) {
      setError(message(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
    getLibraryContext().then(setContext).catch(() => undefined);
  }, [load]);

  async function remove() {
    if (!book || !window.confirm(`Delete "${book.title}" and its copies from the catalogue?`)) return;
    try {
      await deleteBook(book.id);
      router.push("/library");
    } catch (e) {
      setError(message(e));
    }
  }

  if (!book) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <LibraryNav />
        {error ? <InlineAlert>{error}</InlineAlert> : <p className="text-sm text-muted-foreground">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <LibraryNav />
      <div className="space-y-1">
        <Link href="/library" className="text-sm text-muted-foreground hover:underline">
          ← Catalogue
        </Link>
        <h1 className="break-words font-serif text-2xl font-semibold">{book.title}</h1>
        <p className="text-sm text-muted-foreground">
          {book.authors ?? "Author not recorded"}
          {book.referenceOnly ? " · Reference only" : ` · ${book.available} of ${book.copies} on the shelf`}
        </p>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}
      {notice && <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">{notice}</p>}

      <section className="space-y-3 rounded-md border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Details</h2>
          {canManage && !editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Change details
            </Button>
          )}
        </div>
        {editing && context ? (
          <BookForm
            context={context}
            book={book}
            withCopies={false}
            submitLabel="Save details"
            onCancel={() => setEditing(false)}
            onSubmit={async (fields) => {
              setBook(await updateBook(book.id, fields));
              setEditing(false);
              setNotice("Details saved.");
            }}
          />
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Field label="ISBN" value={book.isbn} />
            <Field label="Publisher" value={[book.publisher, book.publishedYear].filter(Boolean).join(", ") || null} />
            <Field label="Subject" value={book.subjectName} />
            <Field label="Classes" value={book.levels.map((l) => l.name).join(", ") || null} />
            <Field label="Shelf" value={book.shelfLocation} />
            <Field label="Replacement price" value={book.replacementPrice != null ? formatKobo(book.replacementPrice) : null} />
          </dl>
        )}
      </section>

      <section aria-labelledby="copies-heading" className="space-y-3">
        <h2 id="copies-heading" className="font-medium">
          Copies
        </h2>
        {book.copyList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No copies yet.</p>
        ) : (
          <ul className="divide-y rounded-md border bg-card">
            {book.copyList.map((c) => (
              <CopyRow
                key={c.id}
                copy={c}
                canManage={canManage}
                onChange={async (status) => {
                  setError(null);
                  try {
                    setBook(await updateCopy(c.id, { status }));
                  } catch (e) {
                    setError(message(e));
                  }
                }}
              />
            ))}
          </ul>
        )}
        {canManage && context && <AddCopies bookId={book.id} next={context.settings.nextAccession} onAdded={(b) => {
          setBook(b);
          setNotice("Copies added.");
          getLibraryContext().then(setContext).catch(() => undefined);
        }} />}
      </section>

      {canManage && !book.hasLoans && (
        <section className="space-y-2 rounded-md border bg-card p-4">
          <h2 className="font-medium">Delete this book</h2>
          <p className="text-sm text-muted-foreground">It has never been lent, so it can be removed from the catalogue with its copies.</p>
          <Button variant="outline" size="sm" onClick={() => void remove()}>
            Delete book
          </Button>
        </section>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words">{value ?? "—"}</dd>
    </div>
  );
}

function CopyRow({ copy, canManage, onChange }: { copy: LibraryCopyDto; canManage: boolean; onChange: (status: "AVAILABLE" | "WITHDRAWN") => Promise<void> }) {
  const late = copy.loan?.overdue;
  return (
    <li className={`flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between ${late ? "bg-amber-500/10" : ""}`}>
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium tabular-nums">No. {copy.accessionNumber}</p>
        <p className="text-muted-foreground">
          {COPY_STATUS_LABEL[copy.status]}
          {copy.loan && ` · ${copy.loan.borrower.name} (${copy.loan.borrower.detail}) · ${dueText(copy.loan)}`}
          {copy.note && ` · ${copy.note}`}
        </p>
      </div>
      {canManage && copy.status === "AVAILABLE" && (
        <Button size="sm" variant="outline" onClick={() => void onChange("WITHDRAWN")} aria-label={`Withdraw copy ${copy.accessionNumber}`}>
          Withdraw
        </Button>
      )}
      {canManage && copy.status === "WITHDRAWN" && (
        <Button size="sm" variant="outline" onClick={() => void onChange("AVAILABLE")} aria-label={`Put copy ${copy.accessionNumber} back on the shelf`}>
          Put back on the shelf
        </Button>
      )}
    </li>
  );
}

function AddCopies({ bookId, next, onAdded }: { bookId: string; next: number; onAdded: (b: LibraryBookDto) => void }) {
  const [open, setOpen] = useState(false);
  const [numbering, setNumbering] = useState<"auto" | "typed">("auto");
  const [count, setCount] = useState("1");
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    let body;
    if (numbering === "auto") {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 1 || n > 200) return setError("Enter how many copies, from 1 to 200.");
      body = { count: n };
    } else {
      const numbers = typed.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      if (numbers.length === 0) return setError("Type at least one accession number.");
      body = { accessionNumbers: numbers };
    }
    setSaving(true);
    setError(null);
    try {
      onAdded(await addCopies(bookId, body));
      setOpen(false);
      setTyped("");
      setCount("1");
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add copies
      </Button>
    );
  }
  return (
    <form
      className="space-y-3 rounded-md border bg-card p-4"
      aria-label="Add copies"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error && <InlineAlert>{error}</InlineAlert>}
      <CopiesFields numbering={numbering} setNumbering={setNumbering} count={count} setCount={setCount} typed={typed} setTyped={setTyped} next={next} idPrefix="add" />
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Adding…" : "Add copies"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
