"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  CALENDAR_CATEGORY_LABELS,
  SCHOOL_EVENT_CATEGORIES,
  SCHOOL_EVENT_DESCRIPTION_MAX,
  SCHOOL_EVENT_TITLE_MAX,
  lagosTodayIso,
  type SchoolEventCategory,
  type SchoolEventDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";

export interface SchoolEventFormValues {
  title: string;
  description: string | null;
  category: SchoolEventCategory;
  startDate: string;
  endDate: string;
}

const FIELD =
  "h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Phase 8 / CP1 — create/edit a school event. The visibility notice is part of
// the form on purpose (D25): every school event is seen by everyone at the
// school, parents and students included, and an admin must know that BEFORE
// they publish a "staff meeting", not after.
export function SchoolEventFormModal({
  open,
  editing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing: SchoolEventDto | null;
  onClose: () => void;
  onSubmit: (values: SchoolEventFormValues) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<SchoolEventCategory>("EVENT");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitle(editing.title);
      setDescription(editing.description ?? "");
      setCategory(editing.category);
      setStartDate(editing.startDate);
      setEndDate(editing.endDate);
    } else {
      const today = lagosTodayIso();
      setTitle("");
      setDescription("");
      setCategory("EVENT");
      setStartDate(today);
      setEndDate(today);
    }
    setError(null);
    setSubmitting(false);
  }, [open, editing]);

  // Display-only check so the button reflects the obvious mistake; the API's Zod
  // schema and the database CHECK constraint are what actually enforce it.
  const rangeInvalid = Boolean(startDate && endDate && endDate < startDate);
  const canSubmit = title.trim().length > 0 && Boolean(startDate) && Boolean(endDate) && !rangeInvalid;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        category,
        startDate,
        endDate,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the event.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit event" : "Add an event"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            Everyone at your school — staff, parents and students — will see this event.
          </p>

          {error && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="event-title">Title</Label>
            <input
              id="event-title"
              className={FIELD}
              value={title}
              maxLength={SCHOOL_EVENT_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Inter-house sports"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="event-category">Category</Label>
            <select
              id="event-category"
              className={FIELD}
              value={category}
              onChange={(e) => setCategory(e.target.value as SchoolEventCategory)}
            >
              {SCHOOL_EVENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CALENDAR_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="event-start">Start date</Label>
              <input
                id="event-start"
                type="date"
                className={FIELD}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (!endDate || e.target.value > endDate) setEndDate(e.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="event-end">End date</Label>
              <input
                id="event-end"
                type="date"
                className={FIELD}
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                aria-invalid={rangeInvalid}
              />
            </div>
          </div>
          {rangeInvalid && <p className="text-sm text-destructive">End date cannot be before the start date.</p>}

          <div className="flex flex-col gap-1">
            <Label htmlFor="event-description">Details (optional)</Label>
            <textarea
              id="event-description"
              rows={3}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={description}
              maxLength={SCHOOL_EVENT_DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Add event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
