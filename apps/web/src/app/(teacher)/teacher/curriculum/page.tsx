"use client";

import { AlertCircle, CheckCircle2, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CurriculumDocumentDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  deleteCurriculumDocument,
  isSettled,
  listCurriculumDocuments,
  pasteCurriculumText,
  pollUntilSettled,
  uploadCurriculumFile,
} from "@/lib/curriculum/curriculum-api";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

// /teacher/curriculum — Phase 7 / CP2.
//
// The school's curriculum library: upload a scheme of work, see what has been
// ingested, remove one that is out of date.
//
// TWO INPUT MODES, side by side rather than one hidden behind the other. D6
// commits to a text-layer PDF and a paste box, and the paste box is not a
// fallback — it is what keeps this usable when a real school's file will not
// parse. Presenting it as an equal option means a teacher whose PDF is refused
// has somewhere to go immediately, instead of concluding the feature is broken.

interface Option {
  id: string;
  name: string;
}

const MAX_MB = 10;

export default function CurriculumPage() {
  const [documents, setDocuments] = useState<CurriculumDocumentDto[]>([]);
  const [usage, setUsage] = useState<{ documents: number; maxDocuments: number } | null>(null);
  // Sourced from /teacher-scope/me, NOT /class-levels + /subjects — those are
  // owner|admin at the service layer, so they 403 for exactly the users this
  // page is built for. Same trap the lesson-plans page documents.
  const [levels, setLevels] = useState<Option[]>([]);
  const [subjects, setSubjects] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"file" | "paste">("file");
  const [classLevelId, setClassLevelId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, scope] = await Promise.all([listCurriculumDocuments(), getMyScope()]);
      setDocuments(list.documents);
      setUsage({ documents: list.usage.documents, maxDocuments: list.usage.maxDocuments });

      const levelById = new Map<string, Option>();
      for (const arm of scope.classArms) {
        if (!levelById.has(arm.classLevelId)) {
          levelById.set(arm.classLevelId, { id: arm.classLevelId, name: arm.classLevelName });
        }
      }
      setLevels([...levelById.values()]);

      const subjectById = new Map<string, Option>();
      for (const list2 of Object.values(scope.subjectsByArm)) {
        for (const s of list2) {
          if (!subjectById.has(s.id)) subjectById.set(s.id, { id: s.id, name: s.name });
        }
      }
      setSubjects([...subjectById.values()]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the curriculum library.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canSubmit =
    classLevelId &&
    subjectId &&
    title.trim().length > 0 &&
    (mode === "file" ? file !== null : pasted.trim().length > 0) &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError(null);
    setNotice(null);

    try {
      const accepted =
        mode === "file"
          ? await uploadCurriculumFile({
              file: file!,
              subjectId,
              classLevelId,
              title: title.trim(),
            })
          : await pasteCurriculumText({
              subjectId,
              classLevelId,
              title: title.trim(),
              content: pasted,
            });

      // The upload is accepted synchronously with a real chunk count, because
      // parsing and chunking happen in the request — only embedding is queued.
      // Saying how many sections were found is the most useful confirmation
      // available at this moment, and it is honest: it is what will be embedded.
      setNotice(
        `Accepted — ${accepted.chunkCount} section${accepted.chunkCount === 1 ? "" : "s"} found. Preparing for search…`,
      );
      setTitle("");
      setPasted("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await load();

      const settled = await pollUntilSettled(accepted.documentId);
      setNotice(
        settled.status === "READY"
          ? `"${settled.title}" is ready — ${settled.chunkCount} sections available to lesson planning.`
          : settled.status === "FAILED"
            ? `"${settled.title}" could not be processed. ${settled.errorMessage ?? ""}`
            : `"${settled.title}" is still processing. It will appear as ready shortly.`,
      );
      await load();
    } catch (e) {
      setFormError(
        e instanceof ApiError ? e.message : "Could not upload the document. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(doc: CurriculumDocumentDto) {
    // Deleting removes the document from what EVERY teacher's lesson plans are
    // grounded in, not just this teacher's — so the confirmation names that
    // consequence rather than asking a generic "are you sure?".
    const ok = window.confirm(
      `Delete "${doc.title}"?\n\nIts ${doc.chunkCount} sections will no longer be used to ground lesson plans for anyone at this school. This cannot be undone.`,
    );
    if (!ok) return;
    try {
      await deleteCurriculumDocument(doc.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete the document.");
    }
  }

  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="font-serif text-3xl">Curriculum library</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Upload your schemes of work so lesson plans are grounded in your own curriculum rather
          than generic material.
        </p>
      </header>

      {error ? (
        <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-sm">
          {error}
        </p>
      ) : null}

      <section className="rounded-lg border p-5">
        <div className="mb-4 flex gap-2">
          <Button
            type="button"
            variant={mode === "file" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("file")}
          >
            Upload a file
          </Button>
          <Button
            type="button"
            variant={mode === "paste" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("paste")}
          >
            Paste the text
          </Button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="classLevel">Class level</Label>
              <select
                id="classLevel"
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                value={classLevelId}
                onChange={(e) => setClassLevelId(e.target.value)}
              >
                <option value="">Select a class level</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject">Subject</Label>
              <select
                id="subject"
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              >
                <option value="">Select a subject</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              placeholder="e.g. Basic Science JSS 2 — First Term"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {mode === "file" ? (
            <div className="space-y-1.5">
              <Label htmlFor="file">Document</Label>
              <Input
                id="file"
                ref={fileInput}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-muted-foreground text-xs">
                PDF with selectable text, or a plain text file. Up to {MAX_MB} MB. Scanned or
                photographed pages are not supported yet — use “Paste the text” instead.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="pasted">Scheme of work</Label>
              <textarea
                id="pasted"
                className="border-input bg-background min-h-48 w-full rounded-md border p-3 text-sm"
                value={pasted}
                placeholder={"FIRST TERM\n\nWEEK 1\nTOPIC: …"}
                onChange={(e) => setPasted(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Keep the week and topic headings — they are what let a lesson plan cite the right
                part of your scheme.
              </p>
            </div>
          )}

          {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
          {notice ? <p className="text-sm">{notice}</p> : null}

          <Button type="submit" disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" /> Add to library
              </>
            )}
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-xl">Documents</h2>
          {usage ? (
            <p className="text-muted-foreground text-xs">
              {usage.documents} of {usage.maxDocuments} used
            </p>
          ) : null}
        </div>

        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-sm">
            Nothing here yet. Add your first scheme of work above.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate font-medium">
                    <FileText className="h-4 w-4 shrink-0" />
                    {doc.title}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {doc.status === "READY"
                      ? `${doc.chunkCount} sections`
                      : doc.status === "FAILED"
                        ? (doc.errorMessage ?? "Could not be processed")
                        : "Preparing for search…"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge status={doc.status} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => void handleDelete(doc)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: CurriculumDocumentDto["status"] }) {
  if (status === "READY") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> Ready
      </Badge>
    );
  }
  if (status === "FAILED") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" /> Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> {isSettled(status) ? status : "Processing"}
    </Badge>
  );
}
