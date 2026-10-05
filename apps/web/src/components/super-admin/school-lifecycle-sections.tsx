"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type {
  PlatformAdminDeleteSchoolResponse,
  PlatformAdminSchoolDeletionCheckDto,
  PlatformAdminSchoolDto,
  PlatformAdminSchoolSuspensionResponse,
  PlatformAdminSuspendSchoolInput,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, proxyFetch } from "@/lib/api-client";

// Platform-admin tools, slice 2 (2026-10-07) — the two lifecycle sections of
// the school "Manage" dialog. Owner's decisions:
//   * Suspend blocks every sign-in (staff, parents, students); live sessions
//     end at their next request. Data is kept, payment links still work.
//   * Delete only a school that never recorded a payment, after typing its
//     slug. Everything else can only be suspended.

const fail = (err: unknown, fallback: string) => toast.error(err instanceof ApiError ? err.message : fallback);

export function SchoolAccessSection({
  school,
  onChanged,
}: {
  school: PlatformAdminSchoolDto;
  onChanged: (patch: Partial<PlatformAdminSchoolDto>) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setReason(""), [school.schoolId]);

  async function call(path: "suspend" | "reactivate") {
    setBusy(true);
    try {
      const body: PlatformAdminSuspendSchoolInput | undefined = path === "suspend" ? { reason: reason.trim() } : undefined;
      const res = await proxyFetch<PlatformAdminSchoolSuspensionResponse>(
        `/api/platform-admin/schools/${school.schoolId}/${path}`,
        { method: "POST", body: body ? JSON.stringify(body) : undefined },
      );
      onChanged({ suspendedAt: res.suspendedAt });
      setReason("");
      toast.success(path === "suspend" ? `${school.name} is suspended.` : `${school.name} is active again.`);
    } catch (err) {
      fail(err, path === "suspend" ? "Could not suspend the school." : "Could not reactivate the school.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="manage-access">
      <h3 id="manage-access" className="font-medium">
        School access
      </h3>
      {school.suspendedAt ? (
        <>
          <p className="rounded-md bg-destructive/10 p-3 text-sm">
            <Badge variant="destructive" className="mr-2">
              Suspended
            </Badge>
            Since {new Date(school.suspendedAt).toLocaleDateString()}. Nobody at this school can sign in. Parents can still pay
            fees through payment links.
          </p>
          <div>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Reactivate ${school.name}? Everyone can sign in again straight away.`)) void call("reactivate");
              }}
            >
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Reactivate school
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Suspending stops staff, parents and students signing in, and signs out anyone already in. Nothing is deleted, and
            parents can still pay fees through payment links. You can reactivate at any time.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="suspend-reason">Reason (kept in the audit log, not shown to the school)</Label>
            <Input
              id="suspend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="e.g. Subscription unpaid since September"
            />
          </div>
          <div>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || reason.trim().length < 3}
              onClick={() => {
                if (window.confirm(`Suspend ${school.name}? Everyone there is signed out.`)) void call("suspend");
              }}
            >
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Suspend school
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function DeleteSchoolSection({
  school,
  onDeleted,
}: {
  school: PlatformAdminSchoolDto;
  onDeleted: (schoolId: string) => void;
}) {
  const [check, setCheck] = useState<PlatformAdminSchoolDeletionCheckDto | null>(null);
  const [checking, setChecking] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setCheck(null);
    setTyped("");
  }, [school.schoolId]);

  async function runCheck() {
    setChecking(true);
    try {
      setCheck(
        await proxyFetch<PlatformAdminSchoolDeletionCheckDto>(`/api/platform-admin/schools/${school.schoolId}/deletion-check`),
      );
    } catch (err) {
      fail(err, "Could not check the school.");
    } finally {
      setChecking(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const res = await proxyFetch<PlatformAdminDeleteSchoolResponse>(`/api/platform-admin/schools/${school.schoolId}/delete`, {
        method: "POST",
        body: JSON.stringify({ confirmSlug: typed.trim() }),
      });
      toast.success(`${school.name} (${res.slug}) was deleted.`);
      onDeleted(school.schoolId);
    } catch (err) {
      fail(err, "Could not delete the school.");
      setDeleting(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="manage-delete">
      <h3 id="manage-delete" className="font-medium">
        Delete school
      </h3>
      {!check ? (
        <>
          <p className="text-sm text-muted-foreground">
            Permanently removes the school and everything in it. Only possible for a school that has never recorded a payment.
          </p>
          <div>
            <Button type="button" variant="outline" disabled={checking} onClick={() => void runCheck()}>
              {checking ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Check whether it can be deleted
            </Button>
          </div>
        </>
      ) : check.deletable ? (
        <>
          <p className="rounded-md bg-destructive/10 p-3 text-sm">
            This deletes <strong>{check.studentCount}</strong> student{check.studentCount === 1 ? "" : "s"},{" "}
            <strong>{check.staffCount}</strong> staff account{check.staffCount === 1 ? "" : "s"},{" "}
            <strong>{check.guardianCount}</strong> parent{check.guardianCount === 1 ? "" : "s"} and everything else in the school.{" "}
            <strong>It cannot be undone.</strong>
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-confirm">
              Type <span className="font-mono">{check.slug}</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <div>
            <Button type="button" variant="destructive" disabled={deleting || typed.trim() !== check.slug} onClick={() => void remove()}>
              {deleting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Delete school permanently
            </Button>
          </div>
        </>
      ) : (
        <p className="rounded-md bg-muted/40 p-3 text-sm">
          <Badge variant="muted" className="mr-2">
            Can&apos;t delete
          </Badge>
          {check.blockers.includes("HAS_PAYMENTS")
            ? `This school has recorded ${check.paymentCount} payment${check.paymentCount === 1 ? "" : "s"}. Suspend it instead.`
            : "This school holds a platform admin account, so it can't be deleted from here."}
        </p>
      )}
    </section>
  );
}
