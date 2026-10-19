"use client";

import { AlertTriangle, IdCard, Loader2, Printer, RefreshCw, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ClassArmDto, IdCardHolderKindDto, IdCardHolderListDto, IdCardHolderRowDto } from "@school-kit/types";

import { PageHeader } from "@/components/layout/page-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { cancelIdCard, issueIdCards, listIdCards, reissueIdCard, rememberCardsToPrint } from "@/lib/id-cards/id-cards-api";

// Student ID cards / Staff ID cards (2026-10-19, docs/modules/id-cards-and-store.md
// §3). Choose people, issue their cards for the current session, then print.
// A lost card is reissued (the old one stops scanning as valid); a card for
// someone who has left is cancelled. Owner and admin.

const COPY = {
  STUDENT: {
    title: "Student ID cards",
    subtitle: "Issue a card to each student for the current session, then print them on A4 sheets or a card printer.",
    numberLabel: "Admission no.",
    detailLabel: "Class",
    photoHref: (id: string) => `/students/${id}`,
  },
  STAFF: {
    title: "Staff ID cards",
    subtitle: "Issue a card to each member of staff for the current session, then print them on A4 sheets or a card printer.",
    numberLabel: "Staff no.",
    detailLabel: "Role",
    photoHref: (id: string) => `/staff/${id}`,
  },
} as const;

export function IdCardsPage({ kind }: { kind: IdCardHolderKindDto }) {
  const copy = COPY[kind];
  const router = useRouter();
  const { permissions } = useAuth();
  const canIssue = hasPermission(permissions, "id-card.issue");
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  const [armId, setArmId] = useState("");
  const [list, setList] = useState<IdCardHolderListDto | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (kind === "STUDENT") void listClassArms().then(setArms).catch(() => setArms([]));
  }, [kind]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await listIdCards(kind, armId || undefined));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the list.");
    } finally {
      setLoading(false);
    }
  }, [kind, armId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => list?.data ?? [], [list]);
  const chosen = rows.filter((r) => selected.has(r.holderId));
  const toIssue = chosen.filter((r) => !r.card);
  const toPrint = chosen.filter((r) => r.card);
  const noPhoto = toPrint.filter((r) => !r.hasPhoto);
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      await load();
      setNotice(message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const issue = () =>
    run(async () => {
      const result = await issueIdCards(
        kind,
        toIssue.map((r) => r.holderId),
      );
      return `${result.issued} ${result.issued === 1 ? "card" : "cards"} issued.`;
    });

  function endCard(row: IdCardHolderRowDto, how: "reissue" | "cancel") {
    const reason = window.prompt(
      how === "reissue"
        ? `Why is ${row.name}'s card being replaced? (for example: lost, damaged)`
        : `Why is ${row.name}'s card being cancelled? (for example: left the school)`,
    );
    if (!reason?.trim()) return;
    void run(async () => {
      if (how === "reissue") {
        await reissueIdCard(row.card!.id, reason.trim());
        return kind === "STUDENT"
          ? `A new card was issued to ${row.name}. The old one no longer scans as valid. To charge for the replacement, add a charge on the student's page.`
          : `A new card was issued to ${row.name}. The old one no longer scans as valid.`;
      }
      await cancelIdCard(row.card!.id, reason.trim());
      return `${row.name}'s card was cancelled.`;
    });
  }

  function print() {
    rememberCardsToPrint(toPrint.map((r) => r.card!.id));
    router.push("/id-cards/print");
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title={copy.title} subtitle={copy.subtitle} />

      {list && !list.academicYear && !loading && (
        <div className="rounded-md bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          There is no current session yet. Set one under{" "}
          <Link href="/settings/academic" className="underline underline-offset-2">
            Sessions & classes
          </Link>{" "}
          first; cards are valid for one session.
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          {kind === "STUDENT" && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Class</span>
              <select
                value={armId}
                onChange={(e) => setArmId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">All classes</option>
                {arms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {list?.academicYear && (
            <span className="text-sm text-muted-foreground">
              Session: <span className="font-medium text-foreground">{list.academicYear.label}</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canIssue && (
            <Button onClick={() => void issue()} disabled={busy || toIssue.length === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <IdCard className="h-4 w-4" />}
              Issue {toIssue.length || ""} {toIssue.length === 1 ? "card" : "cards"}
            </Button>
          )}
          <Button variant="outline" onClick={print} disabled={busy || toPrint.length === 0}>
            <Printer className="h-4 w-4" />
            Print {toPrint.length || ""} {toPrint.length === 1 ? "card" : "cards"}
          </Button>
        </div>
        {noPhoto.length > 0 && (
          <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {noPhoto.length} of the cards to print {noPhoto.length === 1 ? "has" : "have"} no photo:{" "}
              {noPhoto.map((r, i) => (
                <span key={r.holderId}>
                  {i > 0 && ", "}
                  <Link href={copy.photoHref(r.holderId)} className="underline underline-offset-2">
                    {r.name}
                  </Link>
                </span>
              ))}
              . Add one first, or print them without.
            </span>
          </p>
        )}
        {notice && <p className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {kind === "STUDENT" ? "No students are enrolled in this class this term." : "No active staff yet."}
        </p>
      ) : (
        <div className="relative overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Choose everyone"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.holderId)))}
                  />
                </th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">{copy.numberLabel}</th>
                <th className="px-3 py-2">{copy.detailLabel}</th>
                <th className="px-3 py-2">Photo</th>
                <th className="px-3 py-2">Card</th>
                {canIssue && (
                  <th className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.holderId}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Choose ${r.name}`}
                      checked={selected.has(r.holderId)}
                      onChange={() => toggle(r.holderId)}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.number ?? "—"}</td>
                  <td className="px-3 py-2">{r.detail ?? "—"}</td>
                  <td className="px-3 py-2">
                    {r.hasPhoto ? (
                      <span className="text-muted-foreground">Yes</span>
                    ) : (
                      <Link href={copy.photoHref(r.holderId)} className="text-amber-800 underline underline-offset-2 dark:text-amber-300">
                        Add photo
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.card ? (
                      <Badge variant="success">{r.card.cardNumber}</Badge>
                    ) : (
                      <span className="text-muted-foreground">Not issued</span>
                    )}
                  </td>
                  {canIssue && (
                    <td className="px-3 py-2">
                      {r.card && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => endCard(r, "reissue")} disabled={busy}>
                            <RefreshCw className="h-4 w-4" />
                            Replace
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => endCard(r, "cancel")} disabled={busy}>
                            <XCircle className="h-4 w-4" />
                            Cancel
                          </Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
