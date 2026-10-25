"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  ACCOUNT_DELETION_PRINCIPAL_LABELS,
  type AccountDeletionPrincipal,
  type AccountDeletionRequestDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api-client";

// Account deletion requests (docs/modules/account-deletion-requests.md):
// people who asked, from the app, for their account to be deleted. The school
// holds the records, so it decides: remove the account with the tools below,
// or keep it (for example, a child still on the roll), then mark the request
// handled. Owner and admin (user.deactivate).

const HOW: Record<AccountDeletionPrincipal, { text: string; href: string; link: string }> = {
  STAFF: { text: "Deactivate their account under Settings → Users.", href: "/settings/users", link: "Users" },
  GUARDIAN: { text: "Switch off their parent portal access from the Parents page.", href: "/guardians", link: "Parents" },
  STUDENT: {
    text: "Their app access is the parent's to switch off; withdrawing the student also ends it. Their school record stays, as the law on school records needs.",
    href: "/students",
    link: "Students",
  },
};

export default function AccountDeletionRequestsPage() {
  const [rows, setRows] = useState<AccountDeletionRequestDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<AccountDeletionRequestDto[]>("/account-deletion-requests")
      .then(setRows)
      .catch((e: unknown) => {
        setRows([]);
        toast.error(e instanceof ApiError ? e.message : "Could not load the requests.");
      });
  }, []);
  useEffect(load, [load]);

  async function handled(id: string) {
    setBusy(id);
    try {
      await apiFetch<void>(`/account-deletion-requests/${id}/handled`, { method: "POST" });
      setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
      toast.success("Marked as handled.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update the request.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Account deletion requests</h1>
        <p className="text-sm text-muted-foreground">
          People who asked, from the SchoolKit app, for their account to be deleted. Your school holds the records, so you
          decide: remove the account, or keep it and tell them why. Then mark the request handled.
        </p>
      </header>
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">No requests waiting.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{r.name ?? "Record already removed"}</span>
                <span className="text-xs text-muted-foreground">
                  {ACCOUNT_DELETION_PRINCIPAL_LABELS[r.principal]} · asked{" "}
                  {new Date(r.requestedAt).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {HOW[r.principal].text}{" "}
                <Link href={HOW[r.principal].href} className="underline">
                  {HOW[r.principal].link}
                </Link>
              </p>
              <Button type="button" variant="outline" size="sm" className="self-start" disabled={busy === r.id} onClick={() => void handled(r.id)}>
                Mark handled
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
