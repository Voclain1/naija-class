"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import type {
  PlatformAdminCreateSchoolInput,
  PlatformAdminCreateSchoolResponse,
  PlatformAdminSchoolDto,
  PlatformAdminUserDto,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, proxyFetch } from "@/lib/api-client";

// Cross-tenant view — schools + users, basic metadata only (see CLAUDE.md's
// "Platform super-admin" note for the exact allow-listed shape), PLUS one
// write: provisioning a new school (added 2026-08-07, the surface's first).
// No "act as this school" affordance exists here, and none should ever be
// added without also growing the underlying SECURITY DEFINER functions,
// which is the actual enforcement point, not this UI.
export function PlatformAdminDashboard() {
  const router = useRouter();
  const [schools, setSchools] = useState<PlatformAdminSchoolDto[] | null>(null);
  const [users, setUsers] = useState<PlatformAdminUserDto[] | null>(null);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [schoolName, setSchoolName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [lastAcceptUrl, setLastAcceptUrl] = useState<string | null>(null);

  const refreshSchools = () => {
    proxyFetch<PlatformAdminSchoolDto[]>("/api/platform-admin/schools")
      .then(setSchools)
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          router.replace("/super-admin/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Could not load schools.");
      });
  };

  useEffect(refreshSchools, [router]);

  const onProvision = async (e: FormEvent) => {
    e.preventDefault();
    setProvisionError(null);
    setLastAcceptUrl(null);
    setProvisioning(true);
    try {
      const payload: PlatformAdminCreateSchoolInput = { schoolName, ownerEmail };
      const res = await proxyFetch<PlatformAdminCreateSchoolResponse>("/api/platform-admin/schools", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast.success(`${res.schoolName} created — invite sent to ${res.ownerEmail}.`);
      setLastAcceptUrl(res.acceptUrl);
      setSchoolName("");
      setOwnerEmail("");
      refreshSchools();
    } catch (err) {
      setProvisionError(
        err instanceof ApiError ? err.message : "Could not reach the server. Try again in a moment.",
      );
    } finally {
      setProvisioning(false);
    }
  };

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
          <CardTitle>Provision a school</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onProvision} className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="schoolName">School name</Label>
                <Input
                  id="schoolName"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="ownerEmail">Owner email</Label>
                <Input
                  id="ownerEmail"
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={provisioning}>
                  {provisioning ? "Creating…" : "Create & invite"}
                </Button>
              </div>
            </div>
            {provisionError && <p className="text-sm text-destructive">{provisionError}</p>}
            {lastAcceptUrl && (
              <p className="text-sm text-muted-foreground">
                Invite link (fallback if the email doesn&apos;t arrive):{" "}
                <a href={lastAcceptUrl} className="underline" target="_blank" rel="noreferrer">
                  {lastAcceptUrl}
                </a>
              </p>
            )}
          </form>
        </CardContent>
      </Card>

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
                    <TableCell>
                      {school.ownerInvitePending ? (
                        <Badge variant="warning">Pending owner</Badge>
                      ) : (
                        <Badge variant={school.isActive ? "success" : "muted"}>
                          {school.isActive ? "Active" : "Inactive"}
                        </Badge>
                      )}
                    </TableCell>
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
