"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BEHAVIOUR_CATEGORY_NAME_MAX,
  BEHAVIOUR_POINTS_MAX,
  type BehaviourCategoryDto,
  type BehaviourKind,
  type BehaviourSettingsDto,
} from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createBehaviourCategory,
  getBehaviourSettings,
  updateBehaviourCategory,
  updateBehaviourSettings,
} from "@/lib/behaviour/behaviour-api";
import { cn } from "@/lib/utils";

// /settings/behaviour — behaviour points (docs/modules/phase-9.md §9 CP2-D1).
// Owner/admin only; the server enforces it (behaviour.manage).
//
// Off by default. Categories can be set up before points are switched on, so
// a school can prepare its list and then turn it on in one step. A category is
// switched off rather than deleted, because records point at it. Its kind
// cannot change; its value can, and past records keep the value they copied.

function signed(points: number): string {
  return points > 0 ? `+${points}` : `−${Math.abs(points)}`;
}

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export default function BehaviourSettingsPage() {
  const [settings, setSettings] = useState<BehaviourSettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const loaded = await getBehaviourSettings();
      setSettings(loaded);
      setDraft(loaded.pointsEnabled);
    } catch (e) {
      setError(message(e, "Could not load behaviour settings."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = settings !== null && draft !== settings.pointsEnabled;

  async function saveSwitch(): Promise<void> {
    setSaving(true);
    try {
      const updated = await updateBehaviourSettings(draft);
      setSettings(updated);
      setDraft(updated.pointsEnabled);
      toast.success(updated.pointsEnabled ? "Behaviour points are on." : "Behaviour points are off.");
    } catch (e) {
      toast.error(message(e, "Couldn't save — try again."));
    } finally {
      setSaving(false);
    }
  }

  function replaced(category: BehaviourCategoryDto): void {
    setSettings((current) =>
      current
        ? { ...current, categories: current.categories.map((c) => (c.id === category.id ? category : c)) }
        : current,
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Behaviour points</h1>
        <p className="text-sm text-muted-foreground">
          When points are on, a teacher recording a commendation or a concern can choose a category, and the
          category&apos;s points count towards the student&apos;s total for the term. Points are optional: with them
          off, behaviour records work exactly as before.
        </p>
      </header>

      {error ? (
        <InlineAlert>{error}</InlineAlert>
      ) : settings === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4 rounded-md border bg-card p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Use behaviour points</span>
                <span className="text-xs text-muted-foreground">{draft ? "On" : "Off"}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft}
                aria-label="Use behaviour points"
                disabled={saving}
                onClick={() => setDraft((d) => !d)}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                  draft ? "bg-emerald-600" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
                    draft ? "translate-x-5" : "translate-x-0.5",
                  )}
                />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" disabled={!dirty || saving} onClick={() => void saveSwitch()}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {saving ? "Saving…" : "Save"}
              </Button>
              {dirty && <span className="text-xs text-amber-700">Unsaved change.</span>}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-medium">Categories</h2>
              <p className="text-sm text-muted-foreground">
                A commendation scores 1 to {BEHAVIOUR_POINTS_MAX} points and a concern takes 1 to{" "}
                {BEHAVIOUR_POINTS_MAX} away. Changing a value affects new records only.
              </p>
            </div>

            {settings.categories.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                No categories yet. Add the first one below.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {settings.categories.map((category) => (
                  <CategoryRow key={category.id} category={category} onSaved={replaced} />
                ))}
              </ul>
            )}

            <NewCategory
              onAdded={(category) =>
                setSettings((current) => (current ? { ...current, categories: [...current.categories, category] } : current))
              }
            />
          </section>
        </>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  onSaved,
}: {
  category: BehaviourCategoryDto;
  onSaved: (category: BehaviourCategoryDto) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [size, setSize] = useState(String(Math.abs(category.points)));
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const magnitude = Number(size);
  const valid = name.trim() !== "" && Number.isInteger(magnitude) && magnitude >= 1 && magnitude <= BEHAVIOUR_POINTS_MAX;

  async function save(): Promise<void> {
    setBusy(true);
    setRowError(null);
    try {
      const points = category.kind === "COMMENDATION" ? magnitude : -magnitude;
      onSaved(await updateBehaviourCategory(category.id, { name: name.trim(), points }));
      setEditing(false);
    } catch (e) {
      setRowError(message(e, "Could not save that category."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(): Promise<void> {
    setBusy(true);
    setRowError(null);
    try {
      onSaved(await updateBehaviourCategory(category.id, { active: !category.active }));
    } catch (e) {
      setRowError(message(e, "Could not change that category."));
    } finally {
      setBusy(false);
    }
  }

  const tone = category.kind === "COMMENDATION" ? "text-primary" : "text-destructive";

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3",
        // A tinted background, never a coloured edge (CLAUDE.md "Design system").
        category.active ? (category.kind === "COMMENDATION" ? "bg-primary/5" : "bg-destructive/5") : "bg-card opacity-70",
      )}
    >
      {editing ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor={`name-${category.id}`}>Name</Label>
            <Input
              id={`name-${category.id}`}
              value={name}
              maxLength={BEHAVIOUR_CATEGORY_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`points-${category.id}`}>
              {category.kind === "COMMENDATION" ? "Points added" : "Points taken away"}
            </Label>
            <Input
              id={`points-${category.id}`}
              inputMode="numeric"
              className="w-24"
              value={size}
              onChange={(e) => setSize(e.target.value.trim())}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={!valid || busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setName(category.name);
                setSize(String(Math.abs(category.points)));
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="break-words text-sm font-medium">{category.name}</span>
            <span className={cn("text-xs", category.active ? tone : "text-muted-foreground")}>
              {category.kind === "COMMENDATION" ? "Commendation" : "Concern"} · {signed(category.points)} point
              {Math.abs(category.points) === 1 ? "" : "s"}
              {category.active ? "" : " · switched off"}
            </span>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void toggleActive()}>
              {category.active ? "Switch off" : "Switch on"}
            </Button>
          </div>
        </div>
      )}
      {rowError && <InlineAlert>{rowError}</InlineAlert>}
    </li>
  );
}

function NewCategory({ onAdded }: { onAdded: (category: BehaviourCategoryDto) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<BehaviourKind>("COMMENDATION");
  const [size, setSize] = useState("1");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const magnitude = Number(size);
  const sizeValid = Number.isInteger(magnitude) && magnitude >= 1 && magnitude <= BEHAVIOUR_POINTS_MAX;
  const valid = name.trim() !== "" && sizeValid;

  async function add(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const created = await createBehaviourCategory({
        name: name.trim(),
        kind,
        points: kind === "COMMENDATION" ? magnitude : -magnitude,
      });
      onAdded(created);
      setName("");
      setSize("1");
      toast.success(`"${created.name}" added.`);
    } catch (e) {
      setFormError(message(e, "Could not add that category."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4 rounded-lg border bg-card p-4" onSubmit={(e) => void add(e)}>
      <h3 className="text-base font-medium">Add a category</h3>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">Kind</legend>
        {(["COMMENDATION", "CONCERN"] as const).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input type="radio" name="new-kind" value={option} checked={kind === option} onChange={() => setKind(option)} />
            {option === "COMMENDATION" ? "Commendation" : "Concern"}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="new-category-name">Name</Label>
          <Input
            id="new-category-name"
            value={name}
            maxLength={BEHAVIOUR_CATEGORY_NAME_MAX}
            placeholder={kind === "COMMENDATION" ? "For example, Helping others" : "For example, Late to class"}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-category-points">{kind === "COMMENDATION" ? "Points added" : "Points taken away"}</Label>
          <Input
            id="new-category-points"
            inputMode="numeric"
            className="w-24"
            value={size}
            onChange={(e) => setSize(e.target.value.trim())}
          />
        </div>
      </div>
      <span className={cn("text-xs", sizeValid || size === "" ? "text-muted-foreground" : "text-destructive")}>
        A whole number from 1 to {BEHAVIOUR_POINTS_MAX}.
      </span>
      {formError && <InlineAlert>{formError}</InlineAlert>}
      <div>
        <Button type="submit" disabled={!valid || busy}>
          {busy ? "Adding…" : "Add category"}
        </Button>
      </div>
    </form>
  );
}
