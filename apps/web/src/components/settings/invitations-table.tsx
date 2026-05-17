"use client";

import { Copy, Check } from "lucide-react";
import { useState } from "react";

import type { PendingInvitationDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";

// Map of invitation-id → accept URL for invitations just created during
// this page mount. The raw token is single-use and not persisted, so we
// only know it (and can therefore offer "Copy link") for invitations the
// admin just created in this session. Older invitations show "Copy link
// unavailable" with a tooltip — re-issue would solve that, but it's
// deferred (see docs/deferred.md "Re-issue / revoke pending invitations").
export type CopyableUrlMap = Record<string, string>;

interface Props {
  invitations: PendingInvitationDto[];
  copyableUrls: CopyableUrlMap;
}

export function InvitationsTable({ invitations, copyableUrls }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Invited by</th>
            <th className="px-3 py-2 font-medium">Sent</th>
            <th className="px-3 py-2 font-medium">Expires</th>
            <th className="px-3 py-2 font-medium">Link</th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((inv) => {
            const url = copyableUrls[inv.id];
            const isCopied = copiedId === inv.id;
            return (
              <tr key={inv.id} className="border-t">
                <td className="px-3 py-2">{inv.email}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {inv.invitedBy.firstName} {inv.invitedBy.lastName}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {new Date(inv.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {new Date(inv.expiresAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">
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
                  ) : (
                    <span
                      className="text-xs text-muted-foreground"
                      title="Re-issuing invitation links is not supported yet. Create a new invite for this email."
                    >
                      Link unavailable
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
