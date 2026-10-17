"use client";

import { useState } from "react";

import { formatKobo, type CreateBookInput, type LibraryBookDto, type LibraryContextDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { SELECT_CLASSES } from "@/components/transport/term-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { nairaInputToKobo } from "@/lib/finance/naira-input";

// Phase 9 / CP6.1 — a book's details, for adding one and for changing one
// (docs/modules/phase-9.md §14 CP6-D1). Copies are asked for only when adding.

export type BookFields = Omit<CreateBookInput, "copies">;

export function BookForm({
  context,
  book,
  withCopies,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  context: LibraryContextDto;
  book?: LibraryBookDto;
  withCopies: boolean;
  submitLabel: string;
  onSubmit: (fields: BookFields, copies: CreateBookInput["copies"]) => Promise<void>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(book?.title ?? "");
  const [authors, setAuthors] = useState(book?.authors ?? "");
  const [isbn, setIsbn] = useState(book?.isbn ?? "");
  const [publisher, setPublisher] = useState(book?.publisher ?? "");
  const [year, setYear] = useState(book?.publishedYear ? String(book.publishedYear) : "");
  const [subjectId, setSubjectId] = useState(book?.subjectId ?? "");
  const [levelIds, setLevelIds] = useState<string[]>(book?.levels.map((l) => l.id) ?? []);
  const [shelf, setShelf] = useState(book?.shelfLocation ?? "");
  const [price, setPrice] = useState(book?.replacementPrice != null ? formatKobo(book.replacementPrice).replace(/^₦/, "") : "");
  const [referenceOnly, setReferenceOnly] = useState(book?.referenceOnly ?? false);
  const [numbering, setNumbering] = useState<"auto" | "typed">("auto");
  const [count, setCount] = useState("1");
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return setError("Enter the title.");
    const yearValue = year.trim() ? Number(year) : null;
    if (yearValue !== null && (!Number.isInteger(yearValue) || yearValue < 1400 || yearValue > 2100)) return setError("Enter a year such as 2019.");
    let replacementPrice: number | null = null;
    if (price.trim()) {
      replacementPrice = nairaInputToKobo(price);
      if (replacementPrice === null) return setError("Enter the replacement price in naira, such as 4,500.");
    }
    let copies: CreateBookInput["copies"];
    if (withCopies) {
      if (numbering === "auto") {
        const n = Number(count);
        if (count.trim() && (!Number.isInteger(n) || n < 0 || n > 200)) return setError("Enter how many copies, up to 200.");
        copies = n > 0 ? { count: n } : undefined;
      } else {
        const numbers = typed.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
        copies = numbers.length > 0 ? { accessionNumbers: numbers } : undefined;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(
        {
          title: title.trim(),
          authors: authors.trim() || null,
          isbn: isbn.trim() || null,
          publisher: publisher.trim() || null,
          publishedYear: yearValue,
          subjectId: subjectId || null,
          levelIds,
          shelfLocation: shelf.trim() || null,
          replacementPrice,
          referenceOnly,
        },
        copies,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-4"
      aria-label={book ? "Book details" : "New book"}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="book-title">Title</Label>
          <Input id="book-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="book-authors">Author(s)</Label>
          <Input id="book-authors" value={authors} maxLength={300} onChange={(e) => setAuthors(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="book-isbn">ISBN (optional)</Label>
          <Input id="book-isbn" value={isbn} maxLength={20} inputMode="numeric" onChange={(e) => setIsbn(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="book-publisher">Publisher</Label>
          <Input id="book-publisher" value={publisher} maxLength={120} onChange={(e) => setPublisher(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="book-year">Year</Label>
          <Input id="book-year" value={year} maxLength={4} inputMode="numeric" onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="book-subject">Subject (optional)</Label>
          <select id="book-subject" className={SELECT_CLASSES} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">No subject</option>
            {context.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="book-shelf">Shelf location</Label>
          <Input id="book-shelf" value={shelf} maxLength={60} onChange={(e) => setShelf(e.target.value)} placeholder="Fiction, shelf B" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="book-price">Replacement price (₦, optional)</Label>
          <Input id="book-price" value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} />
          <p className="text-xs text-muted-foreground">What a lost copy costs a family.</p>
        </div>
        <div className="flex items-center gap-2 self-center">
          <input id="book-reference" type="checkbox" className="h-4 w-4" checked={referenceOnly} onChange={(e) => setReferenceOnly(e.target.checked)} />
          <Label htmlFor="book-reference">Reference only (not lent out)</Label>
        </div>
      </div>

      {context.levels.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Suits these classes (optional)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {context.levels.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={levelIds.includes(l.id)}
                  onChange={(e) => setLevelIds((ids) => (e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id)))}
                />
                {l.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {withCopies && <CopiesFields numbering={numbering} setNumbering={setNumbering} count={count} setCount={setCount} typed={typed} setTyped={setTyped} next={context.settings.nextAccession} idPrefix="book" />}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function CopiesFields({
  numbering,
  setNumbering,
  count,
  setCount,
  typed,
  setTyped,
  next,
  idPrefix,
}: {
  numbering: "auto" | "typed";
  setNumbering: (v: "auto" | "typed") => void;
  count: string;
  setCount: (v: string) => void;
  typed: string;
  setTyped: (v: string) => void;
  next: number;
  idPrefix: string;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Copies</legend>
      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
        <label className="flex items-center gap-2">
          <input type="radio" name={`${idPrefix}-numbering`} checked={numbering === "auto"} onChange={() => setNumbering("auto")} />
          Number them for me (from {next})
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name={`${idPrefix}-numbering`} checked={numbering === "typed"} onChange={() => setNumbering("typed")} />
          I&apos;ll type the numbers on their labels
        </label>
      </div>
      {numbering === "auto" ? (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-count`}>Number of copies</Label>
          <Input id={`${idPrefix}-count`} className="w-24" value={count} inputMode="numeric" onChange={(e) => setCount(e.target.value)} />
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-numbers`}>Accession numbers, one per line</Label>
          <textarea
            id={`${idPrefix}-numbers`}
            className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">A barcode scanner types the number for you.</p>
        </div>
      )}
    </fieldset>
  );
}
