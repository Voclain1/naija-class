"use client";

import { FileUp, Loader2, UserCog, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  PendingInvitationDto,
  TeacherProfileDto,
  UserListItemDto,
} from "@school-kit/types";

import { ExportCsvButton } from "@/components/shared/export-csv-button";
import { PrintButton } from "@/components/shared/print-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import { exportRowsAsCsv, type CsvColumn } from "@/lib/csv-export";
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
// Single-invite supports admin/bursar/teacher (POST /users/invite, roleKey
// selectable since 2026-07-31); the CSV import wizard remains the faster path
// for bulk-onboarding many teachers at once. The two CTAs at the top reflect
// that split.

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

// Exports whatever rows are currently on screen (already-loaded, already
// filtered by search/role/status) — no extra fetch, same GET /users +
// /users/invitations reads the page already made.
const STAFF_EXPORT_COLUMNS: CsvColumn<StaffRow>[] = [
  { header: "Name", accessor: (r) => r.name },
  { header: "Email", accessor: (r) => r.email },
  { header: "Role", accessor: (r) => r.roleLabel },
  {
    header: "Status",
    accessor: (r) => (r.kind === "invitation" ? "Invited" : r.isActive ? "Active" : "Inactive"),
  },
  {
    header: "Profile",
    accessor: (r) => (r.kind === "invitation" ? "" : r.hasProfile ? "Has profile" : "Pending profile"),
  },
];

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
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Staff</h1>
          <p className="text-sm text-muted-foreground print:hidden">
            Teachers and administrators in your school. Invite one person
            directly, or bulk-invite teachers from a CSV.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <ExportCsvButton
            onExport={() => exportRowsAsCsv("staff.csv", filtered, STAFF_EXPORT_COLUMNS)}
            disabled={filtered.length === 0}
          />
          <PrintButton />
          <Button asChild variant="outline">
            <Link href="/staff/import">
              <FileUp className="mr-1 h-4 w-4" />
              Import teachers (CSV)
            </Link>
          </Button>
          <Button asChild>
            <Link href="/staff/invite">
              <UserPlus className="mr-1 h-4 w-4" />
              Invite staff
            </Link>
          </Button>
        </div>
      </header>

      {profileLookupTruncated && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 print:hidden">
          Showing teacher-profile status for the first 200 teachers only.
          Profiles beyond that may show as &ldquo;Pending profile&rdquo; here
          even when one exists — open the staff member to confirm.
        </div>
      )}

      <section className="flex flex-col gap-3 sm:flex-row sm:items-end print:hidden">
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
            Invite a staff member, or bulk-invite your teachers from a CSV.
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
                Invite staff
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
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Profile</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="print:hidden" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.kind}:${r.id}`}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {r.email || "—"}
              </TableCell>
              <TableCell>{r.roleLabel}</TableCell>
              <TableCell>
                {r.kind === "invitation" ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : r.hasProfile ? (
                  <Badge variant="success">Has profile</Badge>
                ) : (
                  <Badge variant="warning">Pending profile</Badge>
                )}
              </TableCell>
              <TableCell>
                {r.kind === "invitation" ? (
                  <Badge
                    variant="outline"
                    className="border-transparent bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                    title="Invitation sent — awaiting acceptance. The accept link was shown when the invite was created."
                  >
                    Invited
                  </Badge>
                ) : r.isActive ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="muted">Inactive</Badge>
                )}
              </TableCell>
              <TableCell className="text-right print:hidden">
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
