"use client";

import { AlertCircle, ArrowLeft, Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { CurriculumChunkDto, CurriculumDocumentDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import {
  approveCurriculumDocument,
  discardCurriculumChunk,
  getCurriculumDocument,
  pollUntilSettled,
  updateCurriculumChunk,
} from "@/lib/curriculum/curriculum-api";

// /teacher/curriculum/[documentId]/review — Phase 7 / CP5.
//
// The review gate. A teacher sees exactly what the parser made of their scheme
// of work, fixes what it got wrong, and only then does anything get embedded.
//
// WHY THIS SCREEN EXISTS AT ALL, since it is easy to mistake for a nicety:
// the chunker mis-read the first real document it was ever given, twice, in
// ways no synthetic fixture caught — and both times a human found it by looking
// at the output. Before this screen that inspection was accidental. Now it is
// the only way through.
//
// The design follows from that. The heading is EDITABLE and prominent because
// the heading is what goes wrong and what gets cited; the body text is shown
// but not editable (D30), because a teacher rewriting the source would make the
// embedded text diverge from the document the school actually holds.

export default function CurriculumReviewPage() {
  const params = useParams<{ documentId: string }>();
  const router = useRouter();
  const documentId = params.documentId;

  const [document, setDocument] = useState<CurriculumDocumentDto | null>(null);
  const [chunks, setChunks] = useState<CurriculumChunkDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyChunkId, setBusyChunkId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await getCurriculumDocument(documentId);
      setDocument(detail.document);
      setChunks(detail.chunks);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this document.");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleHeadingSave(chunk: CurriculumChunkDto, next: string) {
    const trimmed = next.trim();
    const value = trimmed.length === 0 ? null : trimmed;
    if (value === chunk.heading) return;
    setBusyChunkId(chunk.id);
    setError(null);
    try {
      const detail = await updateCurriculumChunk(documentId, chunk.id, { heading: value });
      setDocument(detail.document);
      setChunks(detail.chunks);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save that heading.");
    } finally {
      setBusyChunkId(null);
    }
  }

  async function handleDiscard(chunk: CurriculumChunkDto) {
    // Names what is being dropped, because "section 3" means nothing on a
    // screen where every row looks similar.
    const label = chunk.heading ?? `Section ${chunk.ordinal + 1}`;
    if (!window.confirm(`Remove "${label}" from this document?\n\nIt will not be used for lesson planning.`)) {
      return;
    }
    setBusyChunkId(chunk.id);
    setError(null);
    try {
      const detail = await discardCurriculumChunk(documentId, chunk.id);
      setDocument(detail.document);
      setChunks(detail.chunks);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove that section.");
    } finally {
      setBusyChunkId(null);
    }
  }

  async function handleApprove() {
    setApproving(true);
    setError(null);
    setProgress("Saving your changes and preparing the document for search…");
    try {
      await approveCurriculumDocument(documentId);
      // Approval is where the wait moved to (D28). It is a much better place
      // for it than before the review: the teacher has already done their part
      // and is waiting on the machine, rather than the other way round.
      const settled = await pollUntilSettled(documentId);
      if (settled.status === "READY") {
        setProgress(null);
        router.push("/teacher/curriculum?approved=1");
        return;
      }
      setProgress(null);
      setError(
        settled.status === "FAILED"
          ? (settled.errorMessage ?? "This document could not be prepared for search.")
          : "Still preparing. This document will appear as ready shortly.",
      );
      await load();
    } catch (e) {
      setProgress(null);
      setError(e instanceof ApiError ? e.message : "Could not approve this document.");
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!document) {
    return (
      <div className="space-y-4 p-6">
        <BackLink />
        <p className="text-sm text-destructive">{error ?? "Document not found."}</p>
      </div>
    );
  }

  const inReview = document.status === "AWAITING_REVIEW";

  return (
    <div className="space-y-6 p-6">
      <BackLink />

      <header className="space-y-2">
        <h1 className="font-serif text-3xl">{document.title}</h1>
        {inReview ? (
          <p className="text-muted-foreground max-w-2xl text-sm">
            This is what we read from your document. Check the term, week and topic on each
            section — fix anything that looks wrong, and remove anything that is not part of the
            scheme, like a contents page. Nothing is used for lesson planning until you approve it.
          </p>
        ) : (
          <p className="text-muted-foreground max-w-2xl text-sm">
            {document.status === "READY"
              ? "This document has been approved and is being used to ground lesson plans. To change its sections, delete it and upload it again."
              : "This document is still being prepared. Check back shortly."}
          </p>
        )}
      </header>

      {error ? (
        <p className="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {progress ? (
        <p className="text-muted-foreground flex items-center gap-2 rounded-md border p-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> {progress}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          {chunks.length} section{chunks.length === 1 ? "" : "s"}
          {document.headingEditCount > 0 || document.discardedChunkCount > 0 ? (
            <span>
              {" · "}
              {document.headingEditCount} corrected, {document.discardedChunkCount} removed
            </span>
          ) : null}
        </p>
        {inReview ? (
          <Button type="button" onClick={() => void handleApprove()} disabled={approving}>
            {approving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Approving…
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" /> Approve and use for lesson planning
              </>
            )}
          </Button>
        ) : null}
      </div>

      <ul className="divide-y rounded-lg border">
        {chunks.map((chunk) => (
          <ChunkRow
            key={chunk.id}
            chunk={chunk}
            editable={inReview}
            busy={busyChunkId === chunk.id}
            onSave={(next) => void handleHeadingSave(chunk, next)}
            onDiscard={() => void handleDiscard(chunk)}
          />
        ))}
      </ul>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/teacher/curriculum"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft className="h-4 w-4" /> Curriculum library
    </Link>
  );
}

function ChunkRow({
  chunk,
  editable,
  busy,
  onSave,
  onDiscard,
}: {
  chunk: CurriculumChunkDto;
  editable: boolean;
  busy: boolean;
  onSave: (next: string) => void;
  onDiscard: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chunk.heading ?? "");

  // Re-sync when the row is replaced by a server response, so a save that the
  // server normalised is reflected rather than silently kept as typed.
  useEffect(() => {
    setDraft(chunk.heading ?? "");
  }, [chunk.heading]);

  return (
    <li className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                autoFocus
                aria-label={`Heading for section ${chunk.ordinal + 1}`}
                placeholder="e.g. First Term > WEEK 3 > Adverbs of Frequency"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onSave(draft);
                    setEditing(false);
                  }
                  if (e.key === "Escape") {
                    setDraft(chunk.heading ?? "");
                    setEditing(false);
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                aria-label="Save heading"
                onClick={() => {
                  onSave(draft);
                  setEditing(false);
                }}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Cancel"
                onClick={() => {
                  setDraft(chunk.heading ?? "");
                  setEditing(false);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {chunk.heading ? (
                <p className="truncate font-medium">{chunk.heading}</p>
              ) : (
                // An unheaded chunk is not a neutral state — it is the
                // windowing fallback, which means the parser found no structure
                // here at all. Saying so is what lets a teacher fix it.
                <p className="text-muted-foreground truncate italic">No heading detected</p>
              )}
              {editable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit heading for section ${chunk.ordinal + 1}`}
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{chunk.tokenCount} tokens</Badge>
          {editable ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Remove section ${chunk.ordinal + 1}`}
              disabled={busy}
              onClick={onDiscard}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Read-only by design (D30). Shown because a teacher cannot judge whether
          a heading is right without seeing what sits under it. */}
      <p className="text-muted-foreground line-clamp-4 whitespace-pre-wrap text-xs">
        {chunk.content}
      </p>
    </li>
  );
}
