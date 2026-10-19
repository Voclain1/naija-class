"use client";

import { ArrowLeft, CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { StudentDto } from "@school-kit/types";

import { PageHeader } from "@/components/layout/page-primitives";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { admissionNumberFromFileName, encodeCrop, initialCrop, loadImage } from "@/lib/photos/crop";
import { uploadStudentPhoto } from "@/lib/photos/photos-api";
import { forgetPhoto } from "@/lib/photos/use-photo-urls";
import { listStudents } from "@/lib/students/students-api";

// /students/photos — many passport photos at once (2026-10-19,
// docs/modules/id-cards-and-store.md §2). Each file is named by the child's
// admission number ("SKA-0042.jpg"). A name that matches no student is
// listed, never guessed. Each picture is cropped to passport shape around
// its centre and sent as a JPEG; a photo that needs a better crop can be
// redone on the student's page.

type RowState = "waiting" | "uploading" | "done" | "skipped" | "failed";
interface Row {
  file: File;
  student: StudentDto | null;
  state: RowState;
  message?: string;
}

async function loadAllStudents(): Promise<StudentDto[]> {
  const all: StudentDto[] = [];
  let cursor: string | undefined;
  do {
    const page = await listStudents({ status: "ACTIVE", limit: 200, cursor });
    all.push(...page.data);
    cursor = page.meta.cursor;
  } while (cursor);
  return all;
}

export default function BulkStudentPhotosPage() {
  const [students, setStudents] = useState<Map<string, StudentDto> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [replace, setReplace] = useState(false);
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAllStudents()
      .then((list) => setStudents(new Map(list.map((s) => [s.admissionNumber.trim().toLowerCase(), s]))))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Could not load the students."));
  }, []);

  function choose(files: FileList | null) {
    if (!files || !students) return;
    setRows(
      [...files].map((file) => ({
        file,
        student: students.get(admissionNumberFromFileName(file.name).toLowerCase()) ?? null,
        state: "waiting",
      })),
    );
  }

  function update(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function run() {
    setRunning(true);
    for (const [index, row] of rows.entries()) {
      if (!row.student || row.state === "done") continue;
      if (row.student.hasPhoto && !replace) {
        update(index, { state: "skipped", message: "Already has a photo" });
        continue;
      }
      update(index, { state: "uploading" });
      try {
        const img = await loadImage(row.file);
        const jpeg = await encodeCrop(img, initialCrop(img.naturalWidth, img.naturalHeight));
        await uploadStudentPhoto(row.student.id, jpeg);
        forgetPhoto("student", row.student.id);
        update(index, { state: "done", message: undefined });
      } catch (e) {
        update(index, {
          state: "failed",
          message: e instanceof ApiError || e instanceof Error ? e.message : "Could not upload.",
        });
      }
    }
    setRunning(false);
  }

  const matched = rows.filter((r) => r.student);
  const unmatched = rows.filter((r) => !r.student);
  const done = rows.filter((r) => r.state === "done").length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link
        href="/students"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to students
      </Link>
      <PageHeader
        title="Upload student photos"
        subtitle="Choose many photos at once. Name each file by the student's admission number, for example SKA-0042.jpg."
      />

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => input.current?.click()} disabled={!students || running}>
            {students ? <Upload className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
            Choose photos
          </Button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            aria-label="Choose student photos"
            className="sr-only"
            onChange={(e) => {
              choose(e.target.files);
              e.target.value = "";
            }}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={running} />
            Replace photos students already have
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Each photo is cropped to passport shape around its centre. To adjust one, open the student and choose Change
          photo.
        </p>
      </div>

      {unmatched.length > 0 && (
        <section className="flex flex-col gap-2 rounded-md bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <h2 className="font-medium">
            {unmatched.length} {unmatched.length === 1 ? "file matches" : "files match"} no student
          </h2>
          <p>Rename these to an admission number and choose them again:</p>
          <ul className="list-inside list-disc">
            {unmatched.map((r) => (
              <li key={r.file.name}>{r.file.name}</li>
            ))}
          </ul>
        </section>
      )}

      {matched.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {matched.length} matched · {done} uploaded
            </h2>
            <Button onClick={() => void run()} disabled={running}>
              {running && <Loader2 className="h-4 w-4 animate-spin" />}
              Upload {matched.length} {matched.length === 1 ? "photo" : "photos"}
            </Button>
          </div>
          <ul className="flex flex-col divide-y rounded-md border bg-card">
            {matched.map((r) => (
              <li key={r.file.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">
                    {r.student!.firstName} {r.student!.lastName}
                  </span>{" "}
                  <span className="text-muted-foreground">({r.file.name})</span>
                </span>
                <RowStatus row={r} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RowStatus({ row }: { row: Row }) {
  switch (row.state) {
    case "uploading":
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Uploading" />;
    case "done":
      return (
        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> Uploaded
        </span>
      );
    case "skipped":
      return <span className="text-muted-foreground">{row.message}</span>;
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 text-destructive">
          <XCircle className="h-4 w-4" /> {row.message}
        </span>
      );
    default:
      return <span className="text-muted-foreground">{row.student?.hasPhoto ? "Has a photo" : "Ready"}</span>;
  }
}
