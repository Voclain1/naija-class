"use client";

import { FileUp, Loader2, UserCog, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  PendingInvitationDto,
  TeacherProfileDto,
  UserListItemDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  listStaff,
  listStaffInvitations,
  listTeacherProfiles,
} from "@/lib/staff/staff-api";

// /staff — Phase 1 / Slice 10 cp3 staff roster.
//
// Staff are Users with a teacher/admin/owner role plus any pending
// invitations not yet accepted. The roster unifies three server reads:
//   - GET /users               → accepted staff + their roles + active state
//   - GET /users/invitations   → pending invitations (no User row yet)
//   - GET /teacher-profiles     → which accepted users have an HR profile
//
// Cursor pagination note: GET /users and GET /users/invitations return the
// full set (no server cursor — they're small at pilot scale), so unlike the
// students roster there's no "Load more". The teacher-profiles list IS
// cursor-paginated; we pull one generous page (limit 200) purely to learn
// has-profile state. If a school ever crosses ~200 teachers, paginate that
// lookup — captured as a future concern, not a silent cap (we surface a note
// when the lookup hits the page limit).
//
// Single-invite is admin-only (POST /users/invite hardcodes roleKey="admin");
// teachers are invited in bulk via the CSV import wizard. The two CTAs at the
// top reflect that split honestly.

type RoleFilter = "" | "teacher" | "admin" | "owner";
type StatusFilter = "all" | "active" | "invited";

interface StaffRow {
  kind: "user" | "invitation";
  id: string;
  name: string;
  email: string;
  roleKeys: string[];
  roleLabel: string;
  // user-only:
  isActive?: boolean;
  hasProfile?: boolean;
  profileId?: string;
}

const ROLE_NAMES: Record<string, string> = {
  owner: "Owner",
  admin: "Administrator",
  teacher: "Teacher",
};

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim() || "(no name)";
}

export default function StaffRosterPage() {
  const [users, setUsers] = useState<UserListItemDto[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitationDto[]>([]);
  const [profilesByUserId, setProfilesByUserId] = useState<
    Map<string, TeacherProfileDto>
  >(new Map());
  const [profileLookupTruncated, setProfileLookupTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [role, setRole] = useState<RoleFilter>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [staff, invites, profiles] = await Promise.all([
        listStaff(),
        listStaffInvitations(),
        listTeacherProfiles({ limit: 200 }),
      ]);
      setUsers(staff);
      setInvitations(invites);
      const map = new Map<string, TeacherProfileDto>();
      for (const p of profiles.data) map.set(p.userId, p);
      setProfilesByUserId(map);
      // If the profile lookup filled a full page there may be more — surface
      // it rather than silently mislabel later teachers as "no profile".
      setProfileLookupTruncated(Boolean(profiles.meta.cursor));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load staff.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<StaffRow[]>(() => {
    const userRows: StaffRow[] = users.map((u) => ({
      kind: "user",
      id: u.id,
      name: fullName(u.firstName, u.lastName),
      email: u.email ?? "",
      roleKeys: u.roles.map((r) => r.key),
      roleLabel:
        u.roles.length > 0 ? u.roles.map((r) => r.name).join(", ") : "—",
      isActive: u.isActive,
      hasProfile: profilesByUserId.has(u.id),
      profileId: profilesByUserId.get(u.id)?.id,
    }));
    const inviteRows: StaffRow[] = invitations.map((i) => ({
      kind: "invitation",
      id: i.id,
      name: fullName(i.firstName, i.lastName),
      email: i.email,
      roleKeys: [i.roleKey],
      roleLabel: ROLE_NAMES[i.roleKey] ?? i.roleKey,
    }));
    return [...userRows, ...inviteRows];
  }, [users, invitations, profilesByUserId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "active" && r.kind !== "user") return false;
      if (statusFilter === "invited" && r.kind !== "invitation") return false;
      if (role && !r.roleKeys.includes(role)) return false;
      if (term) {
        const hay = `${r.name} ${r.email}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, search, role, statusFilter]);

  const hasFilters = Boolean(search || role || statusFilter !== "all");
  const totalStaff = rows.length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
          <p className="text-sm text-muted-foreground">
            Teachers and administrators in your school. Invite an admin
            directly, or bulk-invite teachers from a CSV.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/staff/import">
              <FileUp className="mr-1 h-4 w-4" />
              Import teachers (CSV)
            </Link>
          </Button>
          <Button asChild>
            <Link href="/staff/invite">
              <UserPlus className="mr-1 h-4 w-4" />
              Invite admin
            </Link>
          </Button>
        </div>
      </header>

      {profileLookupTruncated && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Showing teacher-profile status for the first 200 teachers only.
          Profiles beyond that may show as &ldquo;Pending profile&rdquo; here
          even when one exists — open the staff member to confirm.
        </div>
      )}

      <section className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="staff-search" className="text-sm font-medium">
            Search
          </label>
          <input
            id="staff-search"
            type="search"
            placeholder="Name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="staff-role" className="text-sm font-medium">
            Role
          </label>
          <select
            id="staff-role"
            value={role}
            onChange={(e) => setRole(e.target.value as RoleFilter)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">All roles</option>
            <option value="teacher">Teacher</option>
            <option value="admin">Administrator</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="staff-status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="staff-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All</option>
            <option value="active">Active (accepted)</option>
            <option value="invited">Invited (pending)</option>
          </select>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : totalStaff === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/30 p-8 text-center">
          <UserCog className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No staff yet.</p>
          <p className="text-sm text-muted-foreground">
            Invite an administrator, or bulk-invite your teachers from a CSV.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline">
              <Link href="/staff/import">
                <FileUp className="mr-1 h-4 w-4" />
                Import teachers (CSV)
              </Link>
            </Button>
            <Button asChild>
              <Link href="/staff/invite">
                <UserPlus className="mr-1 h-4 w-4" />
                Invite admin
              </Link>
            </Button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium">No staff match those filters.</p>
          <p className="text-sm text-muted-foreground">
            Try clearing the search, role, or status filter.
          </p>
        </div>
      ) : (
        <>
          <StaffTable rows={filtered} />
          <p className="text-center text-xs text-muted-foreground">
            {filtered.length}
            {hasFilters ? ` of ${totalStaff}` : ""}{" "}
            {totalStaff === 1 ? "person" : "people"}
          </p>
        </>
      )}
    </div>
  );
}

function StaffTable({ rows }: { rows: StaffRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Profile</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.kind}:${r.id}`} className="border-t">
              <td className="px-3 py-2 font-medium">{r.name}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {r.email || "—"}
              </td>
              <td className="px-3 py-2">{r.roleLabel}</td>
              <td className="px-3 py-2">
                {r.kind === "invitation" ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : r.hasProfile ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                    Has profile
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Pending profile
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                {r.kind === "invitation" ? (
                  <span
                    className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800"
                    title="Invitation sent — awaiting acceptance. The accept link was shown when the invite was created."
                  >
                    Invited
                  </span>
                ) : r.isActive ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                    Active
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Inactive
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {r.kind === "user" ? (
                  <Link
                    href={`/staff/${r.id}`}
                    className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    View
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Pending
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
