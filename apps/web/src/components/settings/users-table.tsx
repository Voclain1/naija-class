import type { UserListItemDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Compact responsive table. Phase 0 doesn't have a deactivate/edit
// affordance yet — that's docs/modules/phase-0.md "users" coverage that
// lands later; the table here exists so the admin can SEE who's been
// added to the school after Slice 7 invites land. Sort is server-side
// (createdAt desc).
interface Props {
  users: UserListItemDto[];
}

export function UsersTable({ users }: Props) {
  if (users.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No other users yet. Invite an admin below to get started.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Last login</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">
                {u.firstName} {u.lastName}
              </TableCell>
              <TableCell className="text-muted-foreground">{u.email ?? "—"}</TableCell>
              <TableCell>
                {u.roles.length === 0 ? "—" : u.roles.map((r) => r.name).join(", ")}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
              </TableCell>
              <TableCell>
                {u.isActive ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="muted">Inactive</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
