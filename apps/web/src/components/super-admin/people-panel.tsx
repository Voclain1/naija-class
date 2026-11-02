"use client";

import { useEffect, useState } from "react";

import type {
  PlatformAdminSchoolDto,
  PlatformAdminUserDto,
} from "@school-kit/types";

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ConsoleHeading } from "./console-shell";
import { usePlatformLoad } from "./platform-load";

// Staff accounts across schools, or one school's (?school=<id>, which the
// Schools page links to). Names, roles, status and dates only: the read
// function deliberately returns no email, phone or platform-admin flag.
export function PeoplePanel() {
  const [schoolId, setSchoolId] = useState<string>("");
  useEffect(() => {
    setSchoolId(
      new URLSearchParams(window.location.search).get("school") ?? "",
    );
  }, []);

  const [schools] = usePlatformLoad<PlatformAdminSchoolDto[]>(
    "/api/platform-admin/schools",
    "Could not load schools.",
  );
  const qs = schoolId ? `?schoolId=${encodeURIComponent(schoolId)}` : "";
  const [users, , error] = usePlatformLoad<PlatformAdminUserDto[]>(
    `/api/platform-admin/users${qs}`,
    "Could not load people.",
  );
  const schoolName = (id: string) =>
    schools?.find((s) => s.schoolId === id)?.name ?? "";

  return (
    <>
      <ConsoleHeading
        title="People"
        description="Staff accounts, newest first."
      />
      <select
        value={schoolId}
        onChange={(e) => {
          setSchoolId(e.target.value);
          const url = e.target.value
            ? `?school=${e.target.value}`
            : window.location.pathname;
          window.history.replaceState(null, "", url);
        }}
        aria-label="School"
        className="h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Every school</option>
        {schools?.map((s) => (
          <option key={s.schoolId} value={s.schoolId}>
            {s.name} ({s.slug})
          </option>
        ))}
      </select>
      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="p-6 text-sm text-destructive">{error}</p>
          ) : users === null ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : users.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No staff accounts.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    {!schoolId && <TableHead>School</TableHead>}
                    <TableHead>Roles</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.userId}>
                      <TableCell className="font-medium">
                        {u.firstName} {u.lastName}
                      </TableCell>
                      {!schoolId && (
                        <TableCell>{schoolName(u.schoolId)}</TableCell>
                      )}
                      <TableCell>{u.roleNames.join(", ") || "—"}</TableCell>
                      <TableCell>
                        {u.isActive ? "Active" : "Inactive"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {u.lastLoginAt
                          ? new Date(u.lastLoginAt).toLocaleDateString("en-NG")
                          : "Never"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {new Date(u.createdAt).toLocaleDateString("en-NG")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
