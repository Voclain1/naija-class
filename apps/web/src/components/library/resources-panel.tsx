"use client";

import { useCallback, useEffect, useState } from "react";

import type { LibraryResourceDto, LibraryResourceListDto } from "@school-kit/types";

import { formatDay, message } from "@/components/library/library-shared";
import { InlineAlert } from "@/components/shared/inline-alert";
import { SELECT_CLASSES } from "@/components/transport/term-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { createResourceFile, createResourceLink, getResourceFile, listResources, removeResource } from "@/lib/library/library-api";

// Phase 9 / CP6.3 — digital resources (docs/modules/phase-9.md §14 CP6-D7): a
// PDF or a link for one subject and some classes, which students in those
// classes read in their app. Used by the library's Resources page and the
// teacher's. What may be added, and removed, is the API's answer: the
// Librarian, owner and admin anything; a teacher only for the subjects they
// teach at those classes, and only their own.

const MAX_BYTES = 10 * 1024 * 1024;

export function ResourcesPanel() {
  const { permissions } = useAuth();
  const canWrite = hasPermission(permissions, "library.resource.write");
  const [data, setData] = useState<LibraryResourceListDto | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (subject: string) => {
    setError(null);
    try {
      setData(await listResources({ subjectId: subject || undefined }));
    } catch (e) {
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  return (
    <div className="space-y-6">
      {error && <InlineAlert>{error}</InlineAlert>}
      {notice && <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">{notice}</p>}

      {canWrite && data && (data.scope.any || data.scope.pairs.length > 0) && (
        <NewResource
          data={data}
          onAdded={(r) => {
            setNotice(`"${r.title}" added. Students in ${r.levels.map((l) => l.name).join(", ")} can now see it.`);
            void load(subjectId);
          }}
        />
      )}
      {canWrite && data && !data.scope.any && data.scope.pairs.length === 0 && (
        <p className="rounded-md bg-muted/40 p-3 text-sm">
          You can add resources for the subjects you teach. You have no subject assigned yet; the school admin assigns them.
        </p>
      )}

      {data && data.scope.subjects.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="resources-subject">Subject</Label>
          <select
            id="resources-subject"
            className={SELECT_CLASSES}
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              void load(e.target.value);
            }}
          >
            <option value="">All subjects</option>
            {(data.scope.any ? data.scope.subjects : uniqueSubjects(data.resources, data.scope.subjects)).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.resources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No resources yet.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {data.resources.map((r) => (
            <ResourceRow
              key={r.id}
              resource={r}
              onRemoved={() => {
                setNotice(`"${r.title}" removed.`);
                void load(subjectId);
              }}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every subject a resource uses, plus the reader's own, for the filter. */
function uniqueSubjects(resources: LibraryResourceDto[], own: { id: string; name: string }[]) {
  const byId = new Map(own.map((s) => [s.id, s]));
  for (const r of resources) byId.set(r.subject.id, r.subject);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function ResourceRow({ resource: r, onRemoved, onError }: { resource: LibraryResourceDto; onRemoved: () => void; onError: (m: string) => void }) {
  async function open() {
    try {
      const { url } = await getResourceFile(r.id);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      onError(message(e));
    }
  }
  async function remove() {
    if (!window.confirm(`Remove "${r.title}"? Students will no longer see it.`)) return;
    try {
      await removeResource(r.id);
      onRemoved();
    } catch (e) {
      onError(message(e));
    }
  }
  return (
    <li className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="break-words font-medium">{r.title}</p>
        {r.description && <p className="break-words text-muted-foreground">{r.description}</p>}
        <p className="text-muted-foreground">
          {r.subject.name} · {r.levels.map((l) => l.name).join(", ")} · {r.kind === "FILE" ? "PDF" : "Link"} · added by {r.addedBy.name},{" "}
          {formatDay(r.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {r.kind === "FILE" ? (
          <Button size="sm" variant="outline" onClick={() => void open()} aria-label={`Open ${r.title}`}>
            Open PDF
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline">
            <a href={r.url!} target="_blank" rel="noopener noreferrer" aria-label={`Open ${r.title}`}>
              Open link
            </a>
          </Button>
        )}
        {r.canRemove && (
          <Button size="sm" variant="ghost" onClick={() => void remove()} aria-label={`Remove ${r.title}`}>
            Remove
          </Button>
        )}
      </div>
    </li>
  );
}

function NewResource({ data, onAdded }: { data: LibraryResourceListDto; onAdded: (r: LibraryResourceDto) => void }) {
  const { scope } = data;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"FILE" | "LINK">("FILE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [levelIds, setLevelIds] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A teacher picks a subject first; the classes are those they teach it at.
  const levels = scope.any
    ? scope.levels
    : scope.levels.filter((l) => scope.pairs.some((p) => p.subjectId === subjectId && p.classLevelId === l.id));

  function reset() {
    setTitle("");
    setDescription("");
    setUrl("");
    setFile(null);
    setLevelIds([]);
  }

  async function save() {
    if (!title.trim()) return setError("Give it a title.");
    if (!subjectId) return setError("Choose the subject.");
    if (levelIds.length === 0) return setError("Choose at least one class.");
    const fields = { title: title.trim(), description: description.trim() || null, subjectId, levelIds };
    setSaving(true);
    setError(null);
    try {
      let added: LibraryResourceDto;
      if (kind === "LINK") {
        if (!/^https:\/\//.test(url.trim())) {
          setSaving(false);
          return setError("The address must start with https://");
        }
        added = await createResourceLink({ ...fields, url: url.trim() });
      } else {
        if (!file) {
          setSaving(false);
          return setError("Choose a PDF.");
        }
        if (file.size > MAX_BYTES) {
          setSaving(false);
          return setError("The PDF is larger than 10 MB.");
        }
        added = await createResourceFile(fields, file);
      }
      reset();
      setOpen(false);
      onAdded(added);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Add a resource</Button>;
  }
  return (
    <form
      className="space-y-4 rounded-md border bg-card p-4"
      aria-label="New resource"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 className="font-medium">Add a resource</h2>
      {error && <InlineAlert>{error}</InlineAlert>}
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Kind</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="resource-kind" checked={kind === "FILE"} onChange={() => setKind("FILE")} />A PDF (up to 10 MB)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="resource-kind" checked={kind === "LINK"} onChange={() => setKind("LINK")} />A web link
        </label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="resource-title">Title</Label>
          <Input id="resource-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="resource-description">Description (optional)</Label>
          <Input id="resource-description" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="resource-subject">Subject</Label>
          <select
            id="resource-subject"
            className={SELECT_CLASSES}
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setLevelIds([]);
            }}
          >
            <option value="">Choose a subject</option>
            {scope.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {kind === "LINK" ? (
          <div className="space-y-1">
            <Label htmlFor="resource-url">Web address</Label>
            <Input id="resource-url" value={url} inputMode="url" placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="resource-file">PDF</Label>
            <Input id="resource-file" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        )}
      </div>
      {subjectId && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">For these classes</legend>
          {levels.length === 0 ? (
            <p className="text-sm text-muted-foreground">No classes to choose.</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {levels.map((l) => (
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
          )}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Add resource"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
