"use client";

import { useEffect, useState } from "react";

import {
  FEE_RISK_LEVEL_LABELS,
  feeRiskReasonText,
  type FeeRiskDto,
  type FeeRiskLevel,
} from "@school-kit/types";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { getStudentFeeRisk } from "@/lib/finance/finance-api";

// Phase 9 / CP10.2 — fee-default risk (docs/modules/phase-9.md §19.3). The
// level is a word as well as a colour; the reasons say why. Shown only to
// those who read the debtor list. It is a prompt to talk to the family and
// never acts by itself.

const RISK_VARIANTS: Record<FeeRiskLevel, BadgeProps["variant"]> = {
  HIGH: "destructive",
  WATCH: "warning",
  LOW: "success",
  TOO_NEW: "muted",
};

export function FeeRiskBadge({ level }: { level: FeeRiskLevel }) {
  return <Badge variant={RISK_VARIANTS[level]}>{FEE_RISK_LEVEL_LABELS[level]}</Badge>;
}

export function FeeRiskReasons({ risk, className }: { risk: FeeRiskDto; className?: string }) {
  if (risk.reasons.length === 0) return null;
  return (
    <ul className={className ?? "mt-1 space-y-0.5 text-xs text-muted-foreground"}>
      {risk.reasons.map((r, i) => (
        <li key={i}>{feeRiskReasonText(r)}</li>
      ))}
    </ul>
  );
}

/** The student page's line, on the Bio tab beside transport and hostel. */
export function StudentFeeRiskField({ studentId }: { studentId: string }) {
  const { permissions } = useAuth();
  const allowed = hasPermission(permissions, "finance.debtors.read");
  const [state, setState] = useState<{ loaded: boolean; value: FeeRiskDto | null }>({ loaded: false, value: null });

  useEffect(() => {
    if (!allowed) return;
    getStudentFeeRisk(studentId)
      .then((value) => setState({ loaded: true, value }))
      .catch(() => setState({ loaded: true, value: null }));
  }, [allowed, studentId]);

  if (!allowed) return null;
  const risk = state.value;
  return (
    <div className="flex flex-col gap-0.5 sm:col-span-2" aria-label="Fee payment risk">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Fee payment risk (staff only)</dt>
      <dd>
        {!state.loaded ? (
          "…"
        ) : risk ? (
          <>
            <FeeRiskBadge level={risk.level} />
            <FeeRiskReasons risk={risk} />
          </>
        ) : (
          "No current term"
        )}
      </dd>
    </div>
  );
}
