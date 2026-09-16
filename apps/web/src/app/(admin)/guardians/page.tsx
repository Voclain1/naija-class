"use client";

import { Ban, Check, Copy, FileUp, Loader2, RefreshCw, Search, Send } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { GuardianPortalStatusDto, GuardianRosterRowDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import {
  inviteGuardian,
  listGuardians,
  resendGuardianInvite,
  revokeGuardianInvite,
} from "@/lib/guardians/guardians-api";
import {
  PORTAL_STATUS_FILTERS,
  PORTAL_STATUS_LABEL,
  rosterActions,
  type RosterAction,
} from "@/lib/guardians/roster-actions";

// /guardians — the guardian roster (2026-09-16).
//
// The canonical entry point for parents, which the product did not have:
// guardians could only be reached one student at a time, through a student's
// Guardians tab, and the import wizard's "View roster" button pointed at
// /students as a stopgap (docs/deferred.md). Its job is to answer, for the
// whole school, "which parents are there, and can each of them get into the
// portal?" — and to let an admin act on the answer.
//
// The status filter runs on the server (GET /guardians?portalStatus=), so
// "Not invited" means every such parent in the school, not the ones on the
// first page. Filter and search live in the URL so a reload keeps them.
//
// Deliberately NOT here: bulk invite. It stays deferred with its recorded
// trigger (a school whose roster makes one-by-one inviting a real pain).

// An expired invitation is something to act on, not an error — warning, not
// destructive (the same distinction InlineAlert's tones draw).
const STATUS_TONE: Record<GuardianPortalStatusDto, "success" | "secondary" | "outline" | "warning" | "muted"> = {
  ACTIVE: "success",
  INVITED: "secondary",
  EXPIRED: "warning",
  NOT_INVITED: "outline",
  NO_EMAIL: "muted",
};

const RELATIONSHIP: Record<string, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
  UNCLE: "Uncle",
  AUNT: "Aunt",
  GRANDPARENT: "Grandparent",
  SIBLING: "Sibling",
  OTHER: "Other",
};

function formatDate(v: string | Date): string {
  return new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function GuardiansRosterPage() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const statusParam = search.get("status");
  const status = PORTAL_STATUS_FILTERS.some((f) => f.value === statusParam && f.value !== "ALL")
    ? (statusParam as GuardianPortalStatusDto)
    : null;
  const query = search.get("q") ?? "";

  const [draft, setDraft] = useState(query);
  const [rows, setRows] = useState<GuardianRosterRowDto[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The one accept link shown after an invite/resend. The raw token is never
  // stored, so this is the only chance to copy it — same as the student tab.
  const [link, setLink] = useState<{ guardianId: string; name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listGuardians({
        ...(status ? { portalStatus: status } : {}),
        ...(query ? { search: query } : {}),
      });
      setRows(res.data);
      setCursor(res.meta.cursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load guardians.");
    } finally {
      setLoading(false);
    }
  }, [status, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => setDraft(query), [query]);

  function setParam(key: "status" | "q", value: string | null) {
    const params = new URLSearchParams(search.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await listGuardians({
        cursor,
        ...(status ? { portalStatus: status } : {}),
        ...(query ? { search: query } : {}),
      });
      setRows((prev) => [...prev, ...res.data]);
      setCursor(res.meta.cursor);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load more guardians.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function act(row: GuardianRosterRowDto, action: RosterAction) {
    setBusyId(row.id);
    const name = `${row.firstName} ${row.lastName}`;
    try {
      if (action === "invite") {
        const res = await inviteGuardian(row.id);
        setLink({ guardianId: row.id, name, url: res.acceptUrl });
        toast.success(`Invitation sent to ${name}.`);
      } else if (action === "resend") {
        const res = await resendGuardianInvite(row.id);
        setLink({ guardianId: row.id, name, url: res.acceptUrl });
        toast.success(`New invitation sent to ${name}. The previous link no longer works.`);
      } else {
        await revokeGuardianInvite(row.id);
        if (link?.guardianId === row.id) setLink(null);
        toast.success(`Invitation cancelled. The link sent to ${name} no longer works.`);
      }
      setCopied(false);
      // Re-read rather than patch locally: the status is derived on the
      // server, and under a filter the row may no longer belong in the list.
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "That did not work. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      // Clipboard unavailable — the link stays selectable in the input.
    }
  }

  const filterLabel = PORTAL_STATUS_FILTERS.find((f) => f.value === (status ?? "ALL"))!.label;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Guardians</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every parent and guardian in your school, and whether they can sign in to the parent portal.
            Parents need portal access to see released results, timetables and fees.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/guardians/import">
            <FileUp className="h-4 w-4" />
            Import guardians
          </Link>
        </Button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Portal access</span>
          <select
            value={status ?? "ALL"}
            onChange={(e) => setParam("status", e.target.value === "ALL" ? null : e.target.value)}
            className="w-56 max-w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {PORTAL_STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <form
          className="flex flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", draft.trim() || null);
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
            <span className="font-medium">Search</span>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Name or phone"
              className="max-w-sm"
            />
          </label>
          <Button type="submit" variant="outline">
            <Search className="h-4 w-4" />
            Search
          </Button>
        </form>
      </div>

      {link && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
          <label htmlFor="roster-invite-url" className="text-xs font-medium">
            Portal invite link for {link.name}
          </label>
          <div className="flex gap-2">
            <Input
              id="roster-invite-url"
              readOnly
              value={link.url}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" variant="outline" size="sm" onClick={copyLink}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            It was also emailed to them. We don&apos;t store this link — once you leave this page it can&apos;t be
            shown again, but you can resend a new one.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          {status || query ? (
            <p className="font-medium text-foreground">No guardians match “{filterLabel}”{query ? ` and “${query}”` : ""}.</p>
          ) : (
            <>
              <p className="font-medium text-foreground">No guardians yet.</p>
              <p className="mt-1">
                Import them from a spreadsheet, or add them one at a time from a student&apos;s Guardians tab.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label="Guardians">
              <TableHeader className="[&_tr]:bg-muted/40">
                <TableRow>
                  <TableHead>Guardian</TableHead>
                  <TableHead>Children</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Portal access</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const actions = rosterActions(row.portalStatus);
                  const busy = busyId === row.id;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="align-top">
                        <div className="font-medium">
                          {row.firstName} {row.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground">{RELATIONSHIP[row.relationship] ?? row.relationship}</div>
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        {row.children.length === 0 ? (
                          <span className="text-muted-foreground">Not linked to a student</span>
                        ) : (
                          <ul className="flex flex-col gap-0.5">
                            {row.children.map((c) => (
                              <li key={c.studentId}>
                                <Link href={`/students/${c.studentId}`} className="hover:underline">
                                  {c.firstName} {c.lastName}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        <div>{row.phone}</div>
                        <div className="text-xs text-muted-foreground">{row.email ?? "No email"}</div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant={STATUS_TONE[row.portalStatus]}>{PORTAL_STATUS_LABEL[row.portalStatus]}</Badge>
                        {row.portalStatus === "INVITED" && row.portalInvitationExpiresAt && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Expires {formatDate(row.portalInvitationExpiresAt)}
                          </div>
                        )}
                        {row.portalStatus === "NO_EMAIL" && (
                          <div className="mt-1 text-xs text-muted-foreground">Add an email from their child&apos;s page</div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-wrap justify-end gap-2">
                          {actions.includes("invite") && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(row, "invite")}>
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                              {row.portalStatus === "EXPIRED" ? "Invite again" : "Invite"}
                            </Button>
                          )}
                          {actions.includes("resend") && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(row, "resend")}>
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              Resend
                            </Button>
                          )}
                          {actions.includes("revoke") && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => act(row, "revoke")}
                              className="text-rose-700 hover:bg-rose-50"
                            >
                              <Ban className="h-4 w-4" />
                              Cancel invite
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {cursor && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
