import type { UserListItemDto } from "@school-kit/types";

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
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Roles</th>
            <th className="px-3 py-2 font-medium">Last login</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t">
              <td className="px-3 py-2">
                {u.firstName} {u.lastName}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{u.email ?? "—"}</td>
              <td className="px-3 py-2">
                {u.roles.length === 0
                  ? "—"
                  : u.roles.map((r) => r.name).join(", ")}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {u.lastLoginAt
                  ? new Date(u.lastLoginAt).toLocaleString()
                  : "Never"}
              </td>
              <td className="px-3 py-2">
                {u.isActive ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                    Active
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Inactive
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
