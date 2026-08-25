"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import type {
  PlatformAdminCreateSchoolInput,
  PlatformAdminCreateSchoolResponse,
  PlatformAdminPaystackSetupRequestDto,
  PlatformAdminPaystackSetupRevealDto,
  PlatformAdminResolvePaystackSetupInput,
  PlatformAdminResolvePaystackSetupResponse,
  PlatformAdminSchoolDto,
  PlatformAdminSetAiEnabledInput,
  PlatformAdminSetAiEnabledResponse,
  PlatformAdminSetEarlyAccessInput,
  PlatformAdminSetEarlyAccessResponse,
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
// "Platform super-admin" note for the exact allow-listed shape), PLUS three
// writes: provisioning a new school (2026-08-07, the surface's first),
// the early-access marker (2026-08-09), and the per-school AI kill switch
// (2026-08-14 — the only one of the three that changes runtime behaviour
// rather than recording a fact).
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
  const [togglingSchoolId, setTogglingSchoolId] = useState<string | null>(null);
  // Separate from togglingSchoolId so the two toggles on the same row don't
  // disable each other mid-flight.
  const [togglingAiSchoolId, setTogglingAiSchoolId] = useState<string | null>(null);

  // Paystack assisted setup queue (2026-08-15). `revealed` is keyed by
  // requestId and deliberately NOT prefetched with the list — every reveal is
  // a separate audited server call, so banking details only exist in this
  // browser's memory for rows the operator explicitly opened.
  const [setupRequests, setSetupRequests] = useState<
    PlatformAdminPaystackSetupRequestDto[] | null
  >(null);
  const [revealed, setRevealed] = useState<
    Record<string, PlatformAdminPaystackSetupRevealDto>
  >({});
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [codeDrafts, setCodeDrafts] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);

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

  const refreshSetupRequests = () => {
    proxyFetch<PlatformAdminPaystackSetupRequestDto[]>(
      "/api/platform-admin/paystack-setup-requests",
    )
      .then(setSetupRequests)
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          router.replace("/super-admin/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Could not load setup requests.");
      });
  };

  useEffect(refreshSchools, [router]);
  useEffect(refreshSetupRequests, [router]);

  // Separate, individually-audited server call — see the reveal endpoint's
  // comment. Not prefetched, and not cached beyond this page view.
  const onReveal = async (requestId: string) => {
    setRevealingId(requestId);
    try {
      const res = await proxyFetch<PlatformAdminPaystackSetupRevealDto>(
        `/api/platform-admin/paystack-setup-requests/${requestId}/reveal`,
      );
      setRevealed((current) => ({ ...current, [requestId]: res }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not reveal details.");
    } finally {
      setRevealingId(null);
    }
  };

  const onResolveSetup = async (
    requestId: string,
    input: PlatformAdminResolvePaystackSetupInput,
  ) => {
    setResolvingId(requestId);
    try {
      await proxyFetch<PlatformAdminResolvePaystackSetupResponse>(
        `/api/platform-admin/paystack-setup-requests/${requestId}`,
        { method: "PATCH", body: JSON.stringify(input) },
      );
      toast.success(
        input.status === "FULFILLED"
          ? "Marked fulfilled — the verified subaccount and split are now connected."
          : "Request rejected. The school sees your reason.",
      );
      // Drop the revealed banking details as soon as the request is closed:
      // there is no reason for them to stay in memory afterwards.
      setRevealed((current) => {
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      refreshSetupRequests();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the request.");
    } finally {
      setResolvingId(null);
    }
  };

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

  // Marker only — this writes School.earlyAccessGrantedAt and nothing reads it
  // to make any decision. It exists so that when paid tiers ship, "who was
  // here early and should be grandfathered" comes from a deliberate flag
  // rather than being reverse-engineered from createdAt (which cannot tell a
  // real pilot school from a smoke-test artifact). See docs/deferred.md
  // "Pricing / tier enforcement".
  const onToggleEarlyAccess = async (schoolId: string, next: boolean) => {
    setTogglingSchoolId(schoolId);
    try {
      const payload: PlatformAdminSetEarlyAccessInput = { earlyAccess: next };
      const res = await proxyFetch<PlatformAdminSetEarlyAccessResponse>(
        `/api/platform-admin/schools/${schoolId}/early-access`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      // Patch the one row in place rather than refetching the whole list —
      // the response is authoritative for the only field that changed.
      setSchools((current) =>
        current === null
          ? current
          : current.map((s) =>
              s.schoolId === schoolId
                ? { ...s, earlyAccessGrantedAt: res.earlyAccessGrantedAt }
                : s,
            ),
      );
      toast.success(next ? "Marked as early access." : "Early access removed.");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not update early access.",
      );
    } finally {
      setTogglingSchoolId(null);
    }
  };

  // NOT a marker, unlike early access above — School.aiEnabled is read on the
  // hot path by the API, so this toggle takes effect on the school's very next
  // request with no deploy. Turning it ON asks for confirmation because it is
  // the deliberate, one-school-at-a-time enablement step the whole rollout is
  // built around; turning it OFF does not, because a kill switch you have to
  // argue with is a broken kill switch.
  const onToggleAi = async (schoolId: string, schoolName: string, next: boolean) => {
    if (next && !window.confirm(`Enable AI features for ${schoolName}?`)) return;
    setTogglingAiSchoolId(schoolId);
    try {
      const payload: PlatformAdminSetAiEnabledInput = { aiEnabled: next };
      const res = await proxyFetch<PlatformAdminSetAiEnabledResponse>(
        `/api/platform-admin/schools/${schoolId}/ai`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      setSchools((current) =>
        current === null
          ? current
          : current.map((s) => (s.schoolId === schoolId ? { ...s, aiEnabled: res.aiEnabled } : s)),
      );
      toast.success(
        next ? `AI enabled for ${schoolName}.` : `AI disabled for ${schoolName}.`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update AI access.");
    } finally {
      setTogglingAiSchoolId(null);
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
      {/* Placed first deliberately: this is the only section that represents
          work waiting on the operator. Schools and Users are reference tables
          you browse; this is a queue, and it is empty most of the time. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pending Paystack setup requests</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? "Hide resolved" : "Show resolved"}
          </Button>
        </CardHeader>
        <CardContent>
          {setupRequests === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            (() => {
              const visible = showResolved
                ? setupRequests
                : setupRequests.filter((r) => r.status === "PENDING");
              if (visible.length === 0) {
                return (
                  <p className="text-sm text-muted-foreground">
                    {showResolved
                      ? "No setup requests yet."
                      : "No schools waiting on a Paystack subaccount."}
                  </p>
                );
              }
              return (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>School</TableHead>
                      <TableHead>Business name</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((r) => {
                      const details = revealed[r.requestId];
                      return (
                        <TableRow key={r.requestId}>
                          <TableCell>{r.schoolName}</TableCell>
                          <TableCell>{r.businessName}</TableCell>
                          <TableCell>{r.contactName}</TableCell>
                          <TableCell>
                            {new Date(r.submittedAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Badge variant={r.status === "PENDING" ? "default" : "secondary"}>
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {r.status !== "PENDING" ? null : details ? (
                              <div className="flex flex-col gap-2">
                                <div className="rounded-md border bg-muted/40 p-2 text-xs">
                                  <div>
                                    <span className="text-muted-foreground">Bank: </span>
                                    {details.bankName}
                                  </div>
                                  <div className="font-mono">
                                    <span className="font-sans text-muted-foreground">
                                      Account:{" "}
                                    </span>
                                    {details.accountNumber}
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Name: </span>
                                    {details.accountName}
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Email: </span>
                                    {details.contactEmail}
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Phone: </span>
                                    {details.contactPhone}
                                  </div>
                                </div>
                                <Input
                                  value={codeDrafts[r.requestId] ?? ""}
                                  onChange={(e) =>
                                    setCodeDrafts((c) => ({
                                      ...c,
                                      [r.requestId]: e.target.value,
                                    }))
                                  }
                                  placeholder="ACCT_xxxxxxxxxx"
                                  className="h-8 font-mono text-xs"
                                  aria-label={`Subaccount code for ${r.schoolName}`}
                                />
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={
                                      resolvingId === r.requestId ||
                                      !(codeDrafts[r.requestId] ?? "").trim()
                                    }
                                    onClick={() =>
                                      onResolveSetup(r.requestId, {
                                        status: "FULFILLED",
                                        subaccountCode: (codeDrafts[r.requestId] ?? "").trim(),
                                      })
                                    }
                                  >
                                    Mark fulfilled
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={resolvingId === r.requestId}
                                    onClick={() => {
                                      const reason = window.prompt(
                                        "Why is this request being rejected? The school will see this.",
                                      );
                                      if (reason?.trim()) {
                                        void onResolveSetup(r.requestId, {
                                          status: "REJECTED",
                                          notes: reason.trim(),
                                        });
                                      }
                                    }}
                                  >
                                    Reject
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={revealingId === r.requestId}
                                onClick={() => onReveal(r.requestId)}
                              >
                                {revealingId === r.requestId ? "Revealing…" : "Reveal details"}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              );
            })()
          )}
        </CardContent>
      </Card>

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
                  <TableHead>Early access</TableHead>
                  <TableHead>AI</TableHead>
                  <TableHead>Staff mobile</TableHead>
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
                      <div className="flex items-center gap-2">
                        {school.earlyAccessGrantedAt ? (
                          <Badge variant="success">
                            {new Date(school.earlyAccessGrantedAt).toLocaleDateString()}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto p-0 text-xs"
                          disabled={togglingSchoolId === school.schoolId}
                          onClick={() =>
                            onToggleEarlyAccess(school.schoolId, !school.earlyAccessGrantedAt)
                          }
                        >
                          {togglingSchoolId === school.schoolId
                            ? "Saving…"
                            : school.earlyAccessGrantedAt
                              ? "Remove"
                              : "Mark"}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {school.aiEnabled ? (
                          <Badge variant="success">On</Badge>
                        ) : (
                          <Badge variant="muted">Off</Badge>
                        )}
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto p-0 text-xs"
                          disabled={togglingAiSchoolId === school.schoolId}
                          onClick={() => onToggleAi(school.schoolId, school.name, !school.aiEnabled)}
                        >
                          {togglingAiSchoolId === school.schoolId
                            ? "Saving…"
                            : school.aiEnabled
                              ? "Disable"
                              : "Enable"}
                        </Button>
                      </div>
                    </TableCell>
                    {/*
                      Staff mobile is READ-ONLY here, deliberately unlike the AI
                      column beside it. Enablement runs through the one-school
                      rollout rail (apps/api/scripts/set-staff-mobile.ts), which
                      requires a dry run and an exactly-matching
                      --confirm-school-id and refuses more than one --school-id.
                      A one-click toggle in a table row would quietly undo that
                      friction, which is the whole point of the rail. What was
                      missing was VISIBILITY — the operator could not read back
                      what a rollout did, and a disable was unverifiable in any
                      direction. That is what this cell fixes.
                    */}
                    <TableCell>
                      {school.staffMobileEnabled ? (
                        <Badge variant="success">On</Badge>
                      ) : (
                        <Badge variant="muted">Off</Badge>
                      )}
                    </TableCell>
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
