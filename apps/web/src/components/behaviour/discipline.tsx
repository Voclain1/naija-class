"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  DISCIPLINE_REASON_MAX,
  describeDisciplineAction,
  type DisciplineActionDto,
  type DisciplineActionStatus,
  type DisciplineActionType,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { decideDiscipline, listDiscipline, proposeDiscipline, withdrawDiscipline } from "@/lib/behaviour/behaviour-api";

// Phase 9 / CP2.3 — discipline actions (docs/modules/phase-9.md §9 CP2-D3).
//
// Three pieces, one file: the proposal form and history on a student's
// Behaviour tab, the decisions queue on the Behaviour page, and the row both
// of them show. What a viewer may do with a row (decide, withdraw) comes from
// the API's `canDecide` / `canWithdraw`, never worked out here.

const TYPE_LABEL: Record<DisciplineActionType, string> = {
  WARNING: "Warning",
  DETENTION: "Detention",
  SUSPENSION: "Suspension",
  EXCLUSION: "Exclusion",
};

const STATUS_LABEL: Record<DisciplineActionStatus, string> = {
  PROPOSED: "Waiting for a decision",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

// A tinted background with the status in words (CLAUDE.md: no accent borders).
const STATUS_TINT: Record<DisciplineActionStatus, string> = {
  PROPOSED: "bg-secondary/10",
  APPROVED: "bg-destructive/5",
  REJECTED: "bg-card",
  WITHDRAWN: "bg-card",
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatMoment(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export function DisciplineActionItem({
  action,
  showStudent,
  onChanged,
}: {
  action: DisciplineActionDto;
  showStudent: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const notified = action.type === "SUSPENSION" || action.type === "EXCLUSION";

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setRejecting(false);
      setRejectReason("");
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function approve() {
    if (
      notified &&
      !window.confirm(
        "Approve this?\n\nThe child's parents will be told the action and its dates, by the app or by SMS. They are never told the reason.",
      )
    ) {
      return;
    }
    void run(() => decideDiscipline(action.id, { decision: "APPROVE" }));
  }

  function withdraw() {
    const told = action.status === "APPROVED" && action.guardiansNotified > 0;
    const message = told
      ? "Withdraw this?\n\nThe parents who were told will get a notice that it has been withdrawn."
      : "Withdraw this?\n\nIt stays on the record as withdrawn.";
    if (!window.confirm(message)) return;
    void run(() => withdrawDiscipline(action.id));
  }

  const ended = action.status === "WITHDRAWN" || action.status === "REJECTED";

  return (
    <li className={["rounded-lg border p-4", STATUS_TINT[action.status], ended ? "opacity-70" : ""].join(" ")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {showStudent && <p className="break-words text-sm font-medium text-foreground">{action.studentName}</p>}
          <p className={["break-words text-sm font-medium", ended ? "line-through" : ""].join(" ")}>
            {describeDisciplineAction(action)}
          </p>
          <p className="text-xs text-muted-foreground">
            {STATUS_LABEL[action.status]} · {action.approvedOnProposal ? "proposed and approved" : "proposed"} by{" "}
            {action.proposedByName ?? "Staff"} on {formatMoment(action.proposedAt)}
          </p>
          {action.decidedAt && action.decidedByName && action.status !== "PROPOSED" && !action.approvedOnProposal && (
            <p className="text-xs text-muted-foreground">
              {action.status === "REJECTED" ? "Rejected" : "Approved"} by {action.decidedByName} on {formatMoment(action.decidedAt)}
            </p>
          )}
          {action.status !== "PROPOSED" && notified && action.decidedAt && action.status !== "REJECTED" && (
            <p className="text-xs text-muted-foreground">
              {action.guardiansNotified === 0
                ? "No parent could be reached by the app or SMS."
                : `${action.guardiansNotified} parent${action.guardiansNotified === 1 ? "" : "s"} told`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {action.canDecide && !rejecting && (
            <>
              <Button size="sm" disabled={busy} onClick={approve}>
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
                Reject
              </Button>
            </>
          )}
          {action.canWithdraw && !rejecting && (
            <Button size="sm" variant="outline" disabled={busy} onClick={withdraw}>
              Withdraw action
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{action.reason}</p>
      {action.decisionReason && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
          Decision: {action.decisionReason}
        </p>
      )}
      {rejecting && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => decideDiscipline(action.id, { decision: "REJECT", reason: rejectReason.trim() }));
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Why is it rejected?</span>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={DISCIPLINE_REASON_MAX}
              rows={2}
              required
              className="rounded-md border border-input bg-background p-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={busy || rejectReason.trim() === ""}>
              Reject
            </Button>
            <Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && (
        <div className="mt-2">
          <InlineAlert>{error}</InlineAlert>
        </div>
      )}
    </li>
  );
}

/** On a student's Behaviour tab: propose an action, and this child's history. */
export function DisciplineSection({ studentId }: { studentId: string }) {
  const [actions, setActions] = useState<DisciplineActionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<DisciplineActionType>("WARNING");
  const [startOn, setStartOn] = useState(isoToday());
  const [endOn, setEndOn] = useState(isoToday());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setActions((await listDiscipline({ studentId })).data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load discipline actions.");
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await proposeDiscipline({
        studentId,
        type,
        reason: reason.trim(),
        ...(type === "WARNING" ? {} : { startOn }),
        ...(type === "SUSPENSION" ? { endOn } : {}),
      });
      setReason("");
      setType("WARNING");
      await load();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Could not propose that action.");
    } finally {
      setSaving(false);
    }
  }

  const dateLabel = type === "DETENTION" ? "Day of the detention" : "First day";

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-base font-medium">Discipline</h3>
      <form className="flex flex-col gap-4 rounded-lg border bg-card p-4" onSubmit={save}>
        <p className="text-sm text-muted-foreground">
          A teacher proposes; an owner or admin approves or rejects. If a suspension or exclusion is approved, the
          child&apos;s parents are told the action and its dates. They are never told the reason.
        </p>
        <label className="flex w-full max-w-xs flex-col gap-1 text-sm">
          <span className="font-medium">Action</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as DisciplineActionType)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {(Object.keys(TYPE_LABEL) as DisciplineActionType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        {type !== "WARNING" && (
          <div className="flex flex-wrap gap-4">
            <label className="flex w-full max-w-[12rem] flex-col gap-1 text-sm">
              <span className="font-medium">{dateLabel}</span>
              <input
                type="date"
                value={startOn}
                onChange={(e) => setStartOn(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                required
              />
            </label>
            {type === "SUSPENSION" && (
              <label className="flex w-full max-w-[12rem] flex-col gap-1 text-sm">
                <span className="font-medium">Last day</span>
                <input
                  type="date"
                  value={endOn}
                  min={startOn}
                  onChange={(e) => setEndOn(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  required
                />
              </label>
            )}
          </div>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Reason (staff only)</span>
          <textarea
            value={reason}
            maxLength={DISCIPLINE_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            required
            className="rounded-md border border-input bg-background p-3 text-sm"
          />
        </label>
        {saveError && <InlineAlert>{saveError}</InlineAlert>}
        <div>
          <Button type="submit" disabled={saving || reason.trim() === ""}>
            {saving ? "Saving…" : "Propose action"}
          </Button>
        </div>
      </form>

      {error && <InlineAlert>{error}</InlineAlert>}
      {actions === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : actions && actions.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {actions.map((a) => (
            <DisciplineActionItem key={a.id} action={a} showStudent={false} onChanged={load} />
          ))}
        </ul>
      ) : actions ? (
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          No discipline actions.
        </div>
      ) : null}
    </section>
  );
}

/**
 * On the Behaviour page: the actions waiting for a decision. An owner or admin
 * sees every one; a teacher sees the ones they proposed.
 */
export function DecisionsQueue() {
  const [actions, setActions] = useState<DisciplineActionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setActions((await listDiscipline({ status: "PROPOSED" })).data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the decisions.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Waiting for a decision</h2>
        <p className="text-sm text-muted-foreground">
          Proposed discipline actions. Nobody decides their own proposal. Propose one from a student&apos;s Behaviour
          tab.
        </p>
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {actions === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : actions && actions.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {actions.map((a) => (
            <DisciplineActionItem key={a.id} action={a} showStudent onChanged={load} />
          ))}
        </ul>
      ) : actions ? (
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          Nothing is waiting for a decision.
        </div>
      ) : null}
    </section>
  );
}
