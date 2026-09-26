"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HOMEWORK_INSTRUCTIONS_MAX,
  HOMEWORK_TITLE_MAX,
  type HomeworkDto,
  type TeacherScopeDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { createHomework, listHomework, withdrawHomework } from "@/lib/homework/homework-api";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

// /teacher/homework — setting work, and seeing what you have set
// (docs/modules/the-school-day.md Part B).
//
// The class and subject pickers are built from the teacher's OWN scope, the
// same list the gradebook uses, so the page cannot offer a class the server
// will refuse. The server re-checks regardless (B8) — this is convenience, not
// the boundary.
//
// Information, not workflow (B7): nothing is collected, submitted or marked
// here. The list below is what was set, and the only action on a row is
// withdraw, which is not a delete (B10).

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDue(dueDate: string): string {
  return new Date(`${dueDate}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function TeacherHomeworkPage() {
  const [scope, setScope] = useState<TeacherScopeDto | null>(null);
  const [items, setItems] = useState<HomeworkDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [classArmId, setClassArmId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mine, homework] = await Promise.all([getMyScope(), listHomework()]);
      setScope(mine);
      setItems(homework.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your homework.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const subjects = useMemo(
    () => (classArmId ? (scope?.subjectsByArm[classArmId] ?? []) : []),
    [scope, classArmId],
  );

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSaved(null);
    setSaving(true);
    try {
      await createHomework({
        classArmId,
        subjectId,
        title: title.trim(),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        dueDate,
      });
      setTitle("");
      setInstructions("");
      setSaved("Set. The class and their parents can see it now.");
      await load();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Could not set that homework.");
    } finally {
      setSaving(false);
    }
  }

  async function withdraw(item: HomeworkDto) {
    const confirmed = window.confirm(
      `Withdraw "${item.title}"?\n\nIt stops showing to ${item.className} and their parents. It stays on your own list, marked withdrawn.`,
    );
    if (!confirmed) return;
    try {
      await withdrawHomework(item.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not withdraw that homework.");
    }
  }

  const arms = scope?.classArms ?? [];
  const canSave = classArmId !== "" && subjectId !== "" && title.trim() !== "" && dueDate !== "" && !saving;

  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Homework</h1>
        <p className="text-sm text-muted-foreground">
          What you have set, and when it is due. Your classes see it in the app; their parents see it too.
        </p>
      </header>

      {error && <InlineAlert>{error}</InlineAlert>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : (
        <>
          <section aria-labelledby="set" className="rounded-lg border bg-card p-4">
            <h2 id="set" className="mb-3 text-lg font-medium">
              Set homework
            </h2>
            {arms.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                You have no classes assigned yet, so there is nothing to set homework for. Ask your school
                administrator.
              </div>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={save}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">Class</span>
                    <select
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={classArmId}
                      onChange={(e) => {
                        setClassArmId(e.target.value);
                        // A subject from the previous class means nothing here,
                        // and the server would refuse the pair.
                        setSubjectId("");
                      }}
                      required
                    >
                      <option value="">Choose a class…</option>
                      {arms.map((arm) => (
                        <option key={arm.id} value={arm.id}>
                          {arm.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">Subject</span>
                    <select
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                      disabled={classArmId === ""}
                      required
                    >
                      <option value="">{classArmId === "" ? "Choose a class first" : "Choose a subject…"}</option>
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">What is it</span>
                  <Input
                    value={title}
                    maxLength={HOMEWORK_TITLE_MAX}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Exercise 4, questions 1–10"
                    required
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Instructions (optional)</span>
                  <textarea
                    value={instructions}
                    maxLength={HOMEWORK_INSTRUCTIONS_MAX}
                    onChange={(e) => setInstructions(e.target.value)}
                    rows={4}
                    className="rounded-md border border-input bg-background p-3 text-sm"
                    placeholder="Show your working. Bring your exercise book."
                  />
                </label>

                <label className="flex w-full max-w-xs flex-col gap-1 text-sm">
                  <span className="font-medium">Due</span>
                  <Input
                    type="date"
                    value={dueDate}
                    min={isoToday()}
                    onChange={(e) => setDueDate(e.target.value)}
                    required
                  />
                </label>

                {saveError && <InlineAlert>{saveError}</InlineAlert>}
                {saved && <p className="text-sm text-primary">{saved}</p>}

                <div>
                  <Button type="submit" disabled={!canSave}>
                    {saving ? "Setting…" : "Set homework"}
                  </Button>
                </div>
              </form>
            )}
          </section>

          <section aria-labelledby="set-list" className="flex flex-col gap-3">
            <h2 id="set-list" className="text-lg font-medium">
              Set recently
            </h2>
            {items.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                You haven&apos;t set any homework yet.
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {items.map((item) => (
                  <li key={item.id} className="rounded-lg border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">
                          {item.title}
                          {item.withdrawnAt && (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              Withdrawn
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.className} · {item.subjectName} · due {formatDue(item.dueDate)}
                        </p>
                      </div>
                      {!item.withdrawnAt && (
                        <Button size="sm" variant="outline" onClick={() => void withdraw(item)}>
                          Withdraw
                        </Button>
                      )}
                    </div>
                    {item.instructions && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.instructions}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
