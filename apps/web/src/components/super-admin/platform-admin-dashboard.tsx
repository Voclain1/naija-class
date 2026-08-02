"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { PlatformAdminSchoolDto, PlatformAdminUserDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, proxyFetch } from "@/lib/api-client";

// Read-only view — schools + users, basic metadata only (see CLAUDE.md's
// "Platform super-admin" note for the exact allow-listed shape). No
// cross-tenant writes and no "act as this school" affordance exist here by
// design; this page can never grow one without also growing the underlying
// SECURITY DEFINER functions, which is the actual enforcement point, not
// this UI.
export function PlatformAdminDashboard() {
  const router = useRouter();
  const [schools, setSchools] = useState<PlatformAdminSchoolDto[] | null>(null);
  const [users, setUsers] = useState<PlatformAdminUserDto[] | null>(null);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    proxyFetch<PlatformAdminSchoolDto[]>("/api/platform-admin/schools")
      .then(setSchools)
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          router.replace("/super-admin/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Could not load schools.");
      });
  }, [router]);

  useEffect(() => {
    const qs = selectedSchoolId ? `?schoolId=${encodeURIComponent(selectedSchoolId)}` : "";
    proxyFetch<PlatformAdminUserDto[]>(`/api/platform-admin/users${qs}`)
      .then(setUsers)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Could not load users.");
      });
  }, [selectedSchoolId]);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Schools</CardTitle>
        </CardHeader>
        <CardContent>
          {schools === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Students</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Signed up</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {schools.map((school) => (
                  <TableRow key={school.schoolId}>
                    <TableCell>{school.name}</TableCell>
                    <TableCell>{school.isActive ? "Active" : "Inactive"}</TableCell>
                    <TableCell>{school.studentCount}</TableCell>
                    <TableCell>{school.staffCount}</TableCell>
                    <TableCell>{new Date(school.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0"
                        onClick={() =>
                          setSelectedSchoolId((current) =>
                            current === school.schoolId ? null : school.schoolId,
                          )
                        }
                      >
                        {selectedSchoolId === school.schoolId ? "Show all users" : "View users"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {selectedSchoolId
              ? `Users — ${schools?.find((s) => s.schoolId === selectedSchoolId)?.name ?? ""}`
              : "Users — all schools"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {users === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.userId}>
                    <TableCell>
                      {user.firstName} {user.lastName}
                    </TableCell>
                    <TableCell>{user.roleNames.join(", ") || "—"}</TableCell>
                    <TableCell>{user.isActive ? "Active" : "Inactive"}</TableCell>
                    <TableCell>
                      {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "Never"}
                    </TableCell>
                    <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
