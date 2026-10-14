"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { lagosTodayIso, type ClassArmDto, type HomeworkDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { listHomework } from "@/lib/homework/homework-api";
import { RECENT_DAYS, splitHomeworkForLookup } from "@/lib/homework/homework-lookup";

// /homework — the counter lookup (docs/modules/the-school-day.md Part B).
//
// A bursar was given homework.read so they could answer "what homework does my
// child have?" at the counter, but no screen showed homework to anyone outside
// the teacher shell (pre-build audit, 2026-10-13). This is that screen: pick a
// class, read what is set. Nothing is written here; teachers set and withdraw
// homework from their own page. Owner and admin see the same list.

function formatDue(dueDate: string): string {
  return new Date(`${dueDate}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function HomeworkRow({ item, today }: { item: HomeworkDto; today: string }) {
  const due = item.dueDate === today ? "due today" : `due ${formatDue(item.dueDate)}`;
  return (
    <li className="flex flex-col gap-1 py-3">
      <p className="break-words font-medium">{item.title}</p>
      <p className="text-sm text-muted-foreground">
        {item.subjectName} · {due}
        {item.postedByName ? ` · set by ${item.postedByName}` : ""}
      </p>
      {item.instructions && <p className="whitespace-pre-line break-words text-sm">{item.instructions}</p>}
    </li>
  );
}

export default function HomeworkLookupPage() {
  const [arms, setArms] = useState<ClassArmDto[] | null>(null);
  const [armsError, setArmsError] = useState<string | null>(null);
  const [classArmId, setClassArmId] = useState("");
  const [items, setItems] = useState<HomeworkDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listClassArms()
      .then((all) => setArms([...all].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))))
      .catch((e) => setArmsError(e instanceof ApiError ? e.message : "Could not load the school's classes."));
  }, []);

  useEffect(() => {
    if (!classArmId) {
      setItems(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listHomework({ classArmId })
      .then((res) => {
        if (!cancelled) setItems(res.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not load that class's homework.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classArmId]);

  const today = lagosTodayIso();
  const lookup = useMemo(() => (items ? splitHomeworkForLookup(items, today) : null), [items, today]);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Homework</h1>
        <p className="text-sm text-muted-foreground">
          What a class has been set, for when a parent asks. Teachers set homework from their own page.
        </p>
      </header>

      {armsError && <InlineAlert>{armsError}</InlineAlert>}

      <label className="flex max-w-sm flex-col gap-1 text-sm">
        <span className="font-medium">Class</span>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={classArmId}
          onChange={(e) => setClassArmId(e.target.value)}
          disabled={!arms || arms.length === 0}
        >
          <option value="">{arms ? "Choose a class" : "Loading classes…"}</option>
          {arms?.map((arm) => (
            <option key={arm.id} value={arm.id}>
              {arm.name}
            </option>
          ))}
        </select>
      </label>

      {arms && arms.length === 0 && (
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          The school has no classes set up yet.
        </div>
      )}

      {error && <InlineAlert>{error}</InlineAlert>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : (
        lookup && (
          <>
            <section aria-labelledby="upcoming" className="rounded-lg border bg-card p-4">
              <h2 id="upcoming" className="text-lg font-medium">
                Due today and later
              </h2>
              {lookup.upcoming.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Nothing is due for this class.</p>
              ) : (
                <ul className="divide-y">
                  {lookup.upcoming.map((item) => (
                    <HomeworkRow key={item.id} item={item} today={today} />
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="recent" className="rounded-lg border bg-card p-4">
              <h2 id="recent" className="text-lg font-medium">
                Due in the last {RECENT_DAYS} days
              </h2>
              {lookup.recent.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Nothing was due this past week.</p>
              ) : (
                <ul className="divide-y">
                  {lookup.recent.map((item) => (
                    <HomeworkRow key={item.id} item={item} today={today} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )
      )}
    </div>
  );
}
