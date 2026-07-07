"use client";

import { Eye, KeyRound, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { BvnStatusDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import {
  captureMyBvn,
  captureStaffBvn,
  getMyBvnStatus,
  getStaffBvnStatus,
  revealMyBvn,
  revealStaffBvn,
} from "@/lib/staff/bvn-api";

import { BvnCaptureModal } from "./bvn-capture-modal";
import { BvnRevealModal } from "./bvn-reveal-modal";

// Phase 3 / Slice 12 — BVN section, reused on both the self-service profile
// page ("self" mode, /users/me/bvn*) and the admin staff detail page
// ("other" mode, /users/:id/bvn*). Capture/reveal for "other" is gated by
// staff-bvn.* permissions (owner/admin only — bursar excluded, mirrors
// payment.refund); "self" needs no permission — every authenticated user
// manages their own BVN regardless of role.
function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

interface Props {
  mode: "self" | "other";
  // Required when mode === "other".
  userId?: string;
}

export function BvnSection({ mode, userId }: Props) {
  const { permissions } = useAuth();
  const [status, setStatus] = useState<BvnStatusDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const [showReveal, setShowReveal] = useState(false);

  const canCapture = mode === "self" || hasPermission(permissions, "staff-bvn.manage-others");
  const canReveal = mode === "self" || hasPermission(permissions, "staff-bvn.reveal");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result =
        mode === "self" ? await getMyBvnStatus() : await getStaffBvnStatus(userId as string);
      setStatus(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load BVN status.");
    } finally {
      setLoading(false);
    }
  }, [mode, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCapture(bvn: string) {
    if (mode === "self") {
      await captureMyBvn({ bvn });
    } else {
      await captureStaffBvn(userId as string, { bvn });
    }
    setShowCapture(false);
    await load();
  }

  async function handleReveal(): Promise<string> {
    const result = mode === "self" ? await revealMyBvn() : await revealStaffBvn(userId as string);
    return result.bvn;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Bank Verification Number
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {status?.hasBvn ? `•••• •••• ${status.bvnLast4}` : "Not on file"}
            </span>
            <span className="text-xs text-muted-foreground">
              {mode === "self"
                ? "Used for payroll bank transfers. Reveal access is logged."
                : "Staff-owned payroll identifier. Reveal access is logged."}
            </span>
          </div>
          <div className="flex gap-2">
            {canCapture && (
              <Button size="sm" variant="outline" onClick={() => setShowCapture(true)}>
                <KeyRound className="h-4 w-4" />
                {status?.hasBvn ? "Update BVN" : "Add BVN"}
              </Button>
            )}
            {status?.hasBvn && canReveal && (
              <Button size="sm" variant="outline" onClick={() => setShowReveal(true)}>
                <Eye className="h-4 w-4" />
                Reveal BVN
              </Button>
            )}
          </div>
        </div>
      )}

      <BvnCaptureModal
        open={showCapture}
        onClose={() => setShowCapture(false)}
        onSubmit={handleCapture}
      />
      <BvnRevealModal
        open={showReveal}
        onClose={() => setShowReveal(false)}
        onReveal={handleReveal}
      />
    </section>
  );
}
