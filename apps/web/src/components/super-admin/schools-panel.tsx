"use client";

import { Check, Copy, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PLAN_LABELS } from "@school-kit/types";
import type {
  PlatformAdminCreateSchoolInput,
  PlatformAdminCreateSchoolResponse,
  PlatformAdminSchoolDto,
  SchoolPlan,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

import { ConsoleHeading } from "./console-shell";
import { usePlatformLoad } from "./platform-load";
import { ownerStatusOf } from "./school-manage";
import { SchoolManageDialog } from "./school-manage-dialog";

// The Schools page (2026-10-30 console redesign): search and filter, five
// columns, and everything else about a school in its Manage dialog (switches,
// AI budget, plan, Smart Import, SMS name, address, website, owner, access,
// delete). Cross-tenant, basic metadata only — see CLAUDE.md's "Platform
// super-admin" note for the allow-listed shape. No "act as this school"
// affordance exists here, and none should ever be added without also growing
// the underlying SECURITY DEFINER functions, which are the enforcement point.

type StatusFilter =
  | "all"
  | "active"
  | "pending-owner"
  | "no-owner"
  | "suspended"
  | "sms";

function statusOf(
  s: PlatformAdminSchoolDto,
): Exclude<StatusFilter, "all" | "sms"> | "inactive" {
  if (s.suspendedAt) return "suspended";
  const owner = ownerStatusOf(s);
  if (owner.kind === "INVITE_PENDING") return "pending-owner";
  if (owner.kind === "NO_OWNER") return "no-owner";
  return s.isActive ? "active" : "inactive";
}

function StatusBadge({ school }: { school: PlatformAdminSchoolDto }) {
  const s = statusOf(school);
  if (s === "suspended") return <Badge variant="destructive">Suspended</Badge>;
  if (s === "pending-owner")
    return <Badge variant="warning">Pending owner</Badge>;
  if (s === "no-owner") return <Badge variant="muted">No owner</Badge>;
  return (
    <Badge variant={s === "active" ? "success" : "muted"}>
      {s === "active" ? "Active" : "Inactive"}
    </Badge>
  );
}

export function SchoolsPanel() {
  const router = useRouter();
  const [schools, setSchools, error] = usePlatformLoad<
    PlatformAdminSchoolDto[]
  >("/api/platform-admin/schools", "Could not load schools.");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [plan, setPlan] = useState<SchoolPlan | "all">("all");
  const [managingSchoolId, setManagingSchoolId] = useState<string | null>(null);
  const [copiedSchoolId, setCopiedSchoolId] = useState<string | null>(null);
  const [provisionOpen, setProvisionOpen] = useState(false);

  // Opening /schools?manage=<id> (from Getting started) opens that school.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("manage");
    if (id) setManagingSchoolId(id);
  }, []);

  const shown = useMemo(() => {
    if (!schools) return [];
    const q = query.trim().toLowerCase();
    return schools.filter((s) => {
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.slug.toLowerCase().includes(q)
      )
        return false;
      if (plan !== "all" && s.plan !== plan) return false;
      if (status === "sms") return s.smsSenderStatus === "REQUESTED";
      if (status !== "all" && statusOf(s) !== status) return false;
      return true;
    });
  }, [schools, query, status, plan]);

  async function copyId(schoolId: string) {
    try {
      await navigator.clipboard.writeText(schoolId);
      setCopiedSchoolId(schoolId);
      window.setTimeout(
        () => setCopiedSchoolId((c) => (c === schoolId ? null : c)),
        2000,
      );
    } catch {
      // A clipboard write can be refused (insecure context, permission policy);
      // a selectable prompt still saves opening DevTools.
      window.prompt("Copy this school ID:", schoolId);
    }
  }

  const plans = Object.keys(PLAN_LABELS) as SchoolPlan[];
  const smsWaiting =
    schools?.filter((s) => s.smsSenderStatus === "REQUESTED").length ?? 0;

  return (
    <>
      <ConsoleHeading
        title="Schools"
        description={
          schools
            ? `${schools.length} schools. Open one to change its switches, plan, owner or access.`
            : undefined
        }
        action={
          <Button onClick={() => setProvisionOpen(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Provision a school
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or code"
            className="pl-9"
            aria-label="Search schools"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Filter by status"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Every status</option>
          <option value="active">Active</option>
          <option value="pending-owner">Pending owner</option>
          <option value="no-owner">No owner</option>
          <option value="suspended">Suspended</option>
          <option value="sms">
            SMS name to submit{smsWaiting ? ` (${smsWaiting})` : ""}
          </option>
        </select>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value as SchoolPlan | "all")}
          aria-label="Filter by plan"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Every plan</option>
          {plans.map((p) => (
            <option key={p} value={p}>
              {PLAN_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <p className="p-6 text-sm text-destructive">{error}</p>
          ) : schools === null ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No school matches.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Students</TableHead>
                    <TableHead className="text-right">Staff</TableHead>
                    <TableHead>Signed up</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((school) => (
                    <TableRow key={school.schoolId}>
                      <TableCell>
                        <div className="flex min-w-[12rem] flex-col items-start gap-0.5">
                          <span className="font-medium">{school.name}</span>
                          {/* The code tells apart schools that share a name. */}
                          <button
                            type="button"
                            onClick={() => void copyId(school.schoolId)}
                            title={`Copy school ID for ${school.name}`}
                            className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
                          >
                            {copiedSchoolId === school.schoolId ? (
                              <Check
                                className="h-3 w-3 text-emerald-600"
                                aria-hidden
                              />
                            ) : (
                              <Copy className="h-3 w-3" aria-hidden />
                            )}
                            <span>{school.slug}</span>
                            <span className="sr-only" role="status">
                              {copiedSchoolId === school.schoolId
                                ? "School ID copied"
                                : `Copy school ID for ${school.name}`}
                            </span>
                          </button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge school={school} />
                          {school.smsSenderStatus === "REQUESTED" && (
                            <Badge variant="warning">SMS name to submit</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="tabular-nums">
                          {school.studentCount}
                        </span>
                        <span
                          className={`block whitespace-nowrap text-xs ${
                            school.studentCap !== null &&
                            school.studentsOnRoll > school.studentCap
                              ? "text-amber-900"
                              : "text-muted-foreground"
                          }`}
                        >
                          {PLAN_LABELS[school.plan]}
                          {school.studentCap !== null
                            ? ` · ${school.studentsOnRoll}/${school.studentCap}`
                            : ""}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {school.staffCount}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {new Date(school.createdAt).toLocaleDateString("en-NG")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              href={`/super-admin/dashboard/people?school=${school.schoolId}`}
                            >
                              People
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setManagingSchoolId(school.schoolId)}
                            aria-label={`Manage ${school.name}`}
                          >
                            Manage
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <SchoolManageDialog
        school={schools?.find((s) => s.schoolId === managingSchoolId) ?? null}
        onClose={() => {
          setManagingSchoolId(null);
          if (window.location.search.includes("manage="))
            router.replace("/super-admin/dashboard/schools");
        }}
        onDeleted={(schoolId) => {
          setManagingSchoolId(null);
          setSchools((current) =>
            current === null
              ? current
              : current.filter((s) => s.schoolId !== schoolId),
          );
        }}
        onChanged={(patch) =>
          setSchools((current) =>
            current === null
              ? current
              : current.map((s) =>
                  s.schoolId === managingSchoolId ? { ...s, ...patch } : s,
                ),
          )
        }
      />

      <ProvisionDialog
        open={provisionOpen}
        onClose={() => setProvisionOpen(false)}
        onCreated={() => {
          proxyFetch<PlatformAdminSchoolDto[]>("/api/platform-admin/schools")
            .then(setSchools)
            .catch(() => undefined);
        }}
      />
    </>
  );
}

function ProvisionDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [schoolName, setSchoolName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAcceptUrl(null);
    setBusy(true);
    try {
      const payload: PlatformAdminCreateSchoolInput = {
        schoolName,
        ownerEmail,
      };
      const res = await proxyFetch<PlatformAdminCreateSchoolResponse>(
        "/api/platform-admin/schools",
        { method: "POST", body: JSON.stringify(payload) },
      );
      toast.success(
        `${res.schoolName} created — invite sent to ${res.ownerEmail}.`,
      );
      setAcceptUrl(res.acceptUrl);
      setSchoolName("");
      setOwnerEmail("");
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the server. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Provision a school</DialogTitle>
          <DialogDescription>
            Creates the school and emails its owner an invitation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ownerEmail">Owner email</Label>
            <Input
              id="ownerEmail"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {acceptUrl && (
            <p className="break-all text-sm text-muted-foreground">
              Invite link (if the email doesn&apos;t arrive):{" "}
              <a
                href={acceptUrl}
                className="underline"
                target="_blank"
                rel="noreferrer"
              >
                {acceptUrl}
              </a>
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create & invite"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
