"use client";

import { Copy, Check } from "lucide-react";
import { useState } from "react";

import type { PendingInvitationDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Map of invitation-id → accept URL for invitations created or re-issued
// during this page mount. The raw token is single-use and not persisted, so
// we only know it (and can therefore offer "Copy link") for those. Any other
// invitation offers "New link", which ends the old link and issues a fresh
// one (POST /users/invitations/:id/resend), and every row can be cancelled.
export type CopyableUrlMap = Record<string, string>;

interface Props {
  invitations: PendingInvitationDto[];
  copyableUrls: CopyableUrlMap;
  onResend?: (id: string) => Promise<void>;
  onRevoke?: (id: string) => Promise<void>;
}

export function InvitationsTable({ invitations, copyableUrls, onResend, onRevoke }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(id: string, action: ((id: string) => Promise<void>) | undefined) {
    if (!action) return;
    setBusyId(id);
    try {
      await action(id);
    } finally {
      setBusyId((b) => (b === id ? null : b));
    }
  }

  async function copy(id: string) {
    const url = copyableUrls[id];
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
    } catch {
      // Clipboard write can fail under insecure context — fall back to
      // showing the URL inline (best-effort, see prompt() fallback below).
      window.prompt("Copy this invitation link:", url);
    }
  }

  if (invitations.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No pending invitations.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Invited by</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Link</TableHead>
            {onRevoke && <TableHead className="sr-only">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.map((inv) => {
            const url = copyableUrls[inv.id];
            const isCopied = copiedId === inv.id;
            return (
              <TableRow key={inv.id}>
                <TableCell>{inv.email}</TableCell>
                <TableCell className="text-muted-foreground">
                  {inv.invitedBy.firstName} {inv.invitedBy.lastName}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(inv.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(inv.expiresAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  {url ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => copy(inv.id)}
                      className="h-7"
                    >
                      {isCopied ? (
                        <>
                          <Check className="mr-1 h-3 w-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="mr-1 h-3 w-3" />
                          Copy link
                        </>
                      )}
                    </Button>
                  ) : onResend ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7"
                      disabled={busyId === inv.id}
                      onClick={() => run(inv.id, onResend)}
                      title="Ends the link already sent and makes a new one you can copy."
                    >
                      New link
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Link unavailable</span>
                  )}
                </TableCell>
                {onRevoke && (
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-destructive hover:text-destructive"
                      disabled={busyId === inv.id}
                      onClick={() => {
                        if (window.confirm(`Cancel the invitation to ${inv.email}? The link already sent will stop working.`)) {
                          void run(inv.id, onRevoke);
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
