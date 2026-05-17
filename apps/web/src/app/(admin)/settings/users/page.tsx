"use client";

import { Loader2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type {
  InviteAdminResponse,
  PendingInvitationDto,
  UserListItemDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { InviteAdminDialog } from "@/components/settings/invite-admin-dialog";
import {
  InvitationsTable,
  type CopyableUrlMap,
} from "@/components/settings/invitations-table";
import { UsersTable } from "@/components/settings/users-table";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { track } from "@/lib/observability/events";
import {
  listPendingInvitations,
  listUsers,
} from "@/lib/users/users-api";

// /settings/users — wrapped by the (admin) layout so RequireAuth has already
// run. The page loads users + pending invitations in parallel, then offers
// an "Invite admin" button that opens a modal. On successful invite we
// optimistically add the new pending row and remember its raw URL for the
// "Copy link" affordance (raw tokens aren't persisted, so the URL is only
// recoverable until page reload — by design, since re-issue is deferred).
export default function SettingsUsersPage() {
  const { school } = useAuth();
  const [users, setUsers] = useState<UserListItemDto[]>([]);
  const [pending, setPending] = useState<PendingInvitationDto[]>([]);
  const [copyableUrls, setCopyableUrls] = useState<CopyableUrlMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, p] = await Promise.all([listUsers(), listPendingInvitations()]);
      setUsers(u);
      setPending(p);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Could not load users. Try again.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreated = useCallback((res: InviteAdminResponse) => {
    // Optimistically prepend the new invitation to the pending list using
    // the inviter info we have on hand. The next page reload will fetch
    // it canonically; this is just so the row appears immediately.
    setPending((prev) => [
      {
        id: res.invitation.id,
        email: res.invitation.email,
        firstName: res.invitation.firstName,
        lastName: res.invitation.lastName,
        roleKey: res.invitation.roleKey,
        // We don't have the inviter's name handy in the response — use a
        // placeholder; the page-reload-after-navigation path will fill it
        // in with the real value from GET /users/invitations.
        invitedBy: { id: "", firstName: "You", lastName: "" },
        expiresAt: res.invitation.expiresAt,
        createdAt: res.invitation.createdAt,
      },
      ...prev,
    ]);
    setCopyableUrls((prev) => ({ ...prev, [res.invitation.id]: res.acceptUrl }));
    if (school) {
      track("invitation_sent", {
        schoolId: school.id,
        roleKey: res.invitation.roleKey,
      });
    }
  }, [school]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Manage admins for your school.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <UserPlus className="mr-1 h-4 w-4" />
          Invite admin
        </Button>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Active users
            </h2>
            <UsersTable users={users} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Pending invitations
            </h2>
            <InvitationsTable invitations={pending} copyableUrls={copyableUrls} />
          </section>
        </>
      )}

      <InviteAdminDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={onCreated}
      />
    </div>
  );
}
