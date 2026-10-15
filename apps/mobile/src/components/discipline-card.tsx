import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DISCIPLINE_REASON_MAX,
  describeDisciplineAction,
  type DisciplineActionDto,
  type DisciplineActionStatus,
  type DisciplineActionType,
} from "@school-kit/types";

import { ApiError } from "../lib/api/client";
import {
  decideStaffDiscipline,
  proposeStaffDiscipline,
  staffDiscipline,
  withdrawStaffDiscipline,
} from "../lib/api/staff-behaviour";
import { queryKeys } from "../lib/query/keys";
import { serverToday } from "../lib/staff/server-date";
import { spacing } from "../theme/tokens";
import { ChoiceChips, DateBoxes, TextField, type DateBoxValues } from "./form";
import { Skeleton } from "./layout";
import { Body, Button, Caption, Card, Heading, Notice } from "./ui";

// Phase 9 / CP2.3 — discipline actions on the staff app
// (docs/modules/phase-9.md §9 CP2-D3). The card on a child's behaviour screen
// proposes one and lists the child's history; the decisions screen reuses the
// row. Whether a viewer may decide or withdraw comes from the API's
// `canDecide` / `canWithdraw`, never worked out here.

const TYPE_OPTIONS: readonly { value: DisciplineActionType; label: string }[] = [
  { value: "WARNING", label: "Warning" },
  { value: "DETENTION", label: "Detention" },
  { value: "SUSPENSION", label: "Suspension" },
  { value: "EXCLUSION", label: "Exclusion" },
];

const STATUS_LABEL: Record<DisciplineActionStatus, string> = {
  PROPOSED: "Waiting for a decision",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function boxesFromIso(iso: string): DateBoxValues {
  const [year = "", month = "", day = ""] = iso.split("-");
  return { day: String(Number(day)), month: String(Number(month)), year };
}

/** "2026-10-20" from three boxes, or null when they do not make a real date. */
export function isoFromBoxes(v: DateBoxValues): string | null {
  const d = Number(v.day);
  const m = Number(v.month);
  const y = Number(v.year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y) || v.year.length !== 4) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** One action, with Approve / Reject / Withdraw where the API allows them. */
export function DisciplineRow({
  action,
  showStudent,
  onChanged,
}: {
  action: DisciplineActionDto;
  showStudent: boolean;
  onChanged: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const notified = action.type === "SUSPENSION" || action.type === "EXCLUSION";

  const decide = useMutation({
    mutationFn: (input: { decision: "APPROVE" } | { decision: "REJECT"; reason: string }) =>
      decideStaffDiscipline(action.id, input),
    onSuccess: () => {
      setRejecting(false);
      setReason("");
      onChanged();
    },
    onError: (e) => Alert.alert("Not saved", errorMessage(e, "We couldn't save that decision. Try again.")),
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawStaffDiscipline(action.id),
    onSuccess: onChanged,
    onError: (e) => Alert.alert("Not withdrawn", errorMessage(e, "We couldn't withdraw that. Try again.")),
  });

  function confirmApprove(): void {
    if (!notified) {
      decide.mutate({ decision: "APPROVE" });
      return;
    }
    Alert.alert(
      "Approve this?",
      "The child's parents will be told the action and its dates, by the app or by SMS. They are never told the reason.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Approve", onPress: () => decide.mutate({ decision: "APPROVE" }) },
      ],
    );
  }

  function confirmWithdraw(): void {
    const told = action.status === "APPROVED" && action.guardiansNotified > 0;
    Alert.alert(
      "Withdraw this?",
      told
        ? "The parents who were told will get a notice that it has been withdrawn."
        : "It stays on the record as withdrawn.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Withdraw", style: "destructive", onPress: () => withdraw.mutate() },
      ],
    );
  }

  const busy = decide.isPending || withdraw.isPending;

  return (
    <View style={styles.row}>
      {showStudent ? <Body>{action.studentName}</Body> : null}
      <Body muted={action.status === "WITHDRAWN" || action.status === "REJECTED"}>{describeDisciplineAction(action)}</Body>
      <Caption>
        {STATUS_LABEL[action.status]} · proposed by {action.proposedByName ?? "Staff"}
      </Caption>
      {action.decidedByName && action.status !== "PROPOSED" ? (
        <Caption>
          {action.status === "REJECTED" ? "Rejected" : "Approved"} by {action.decidedByName}
        </Caption>
      ) : null}
      {notified && action.decidedAt && action.status !== "REJECTED" ? (
        <Caption>
          {action.guardiansNotified === 0
            ? "No parent could be reached by the app or SMS."
            : `${action.guardiansNotified} parent${action.guardiansNotified === 1 ? "" : "s"} told`}
        </Caption>
      ) : null}
      <Body>{action.reason}</Body>
      {action.decisionReason ? <Caption>Decision: {action.decisionReason}</Caption> : null}

      {rejecting ? (
        <View style={styles.form}>
          <TextField
            label="Why is it rejected?"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={DISCIPLINE_REASON_MAX}
            autoCapitalize="sentences"
          />
          <View style={styles.buttons}>
            <Button
              title="Reject"
              loading={decide.isPending}
              disabled={reason.trim() === ""}
              onPress={() => decide.mutate({ decision: "REJECT", reason: reason.trim() })}
            />
            <Button title="Cancel" variant="secondary" disabled={busy} onPress={() => setRejecting(false)} />
          </View>
        </View>
      ) : action.canDecide || action.canWithdraw ? (
        <View style={styles.buttons}>
          {action.canDecide ? <Button title="Approve" loading={decide.isPending} disabled={busy} onPress={confirmApprove} /> : null}
          {action.canDecide ? <Button title="Reject" variant="secondary" disabled={busy} onPress={() => setRejecting(true)} /> : null}
          {action.canWithdraw ? (
            <Button title="Withdraw" variant="secondary" loading={withdraw.isPending} disabled={busy} onPress={confirmWithdraw} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** On a child's behaviour screen: propose an action, and the child's history. */
export function DisciplineCard({
  studentId,
  schoolId,
  userId,
  enabled,
}: {
  studentId: string;
  schoolId: string;
  userId: string;
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const key = queryKeys.staffDiscipline(schoolId, userId, studentId);
  const today = serverToday() ?? new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DisciplineActionType>("WARNING");
  const [start, setStart] = useState<DateBoxValues>(boxesFromIso(today));
  const [end, setEnd] = useState<DateBoxValues>(boxesFromIso(today));
  const [reason, setReason] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);

  const list = useQuery({ queryKey: key, queryFn: () => staffDiscipline(studentId), enabled, staleTime: 60_000 });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: queryKeys.staffDisciplineQueue(schoolId, userId) });
  };

  const propose = useMutation({
    mutationFn: (input: { startOn?: string; endOn?: string }) =>
      proposeStaffDiscipline({ studentId, type, reason: reason.trim(), ...input }),
    onSuccess: () => {
      setReason("");
      setType("WARNING");
      setOpen(false);
      refresh();
    },
    onError: (e) => Alert.alert("Not saved", errorMessage(e, "We couldn't propose that. Check your connection and try again.")),
  });

  function submit(): void {
    setDateError(null);
    if (type === "WARNING") {
      propose.mutate({});
      return;
    }
    const startOn = isoFromBoxes(start);
    if (!startOn) {
      setDateError("Enter a real date.");
      return;
    }
    if (type !== "SUSPENSION") {
      propose.mutate({ startOn });
      return;
    }
    const endOn = isoFromBoxes(end);
    if (!endOn || endOn < startOn) {
      setDateError("The last day must be a real date, not before the first.");
      return;
    }
    propose.mutate({ startOn, endOn });
  }

  if (!enabled) return null;
  const actions = list.data?.data ?? [];

  return (
    <Card>
      <Heading>Discipline</Heading>
      <Caption>
        A teacher proposes; an owner or admin decides. If a suspension or exclusion is approved, the parents are told the
        action and its dates, never the reason.
      </Caption>

      {list.isLoading ? <Skeleton lines={2} /> : null}
      {list.isError ? <Notice tone="warning">We couldn&apos;t load discipline actions.</Notice> : null}
      {actions.map((a) => (
        <DisciplineRow key={a.id} action={a} showStudent={false} onChanged={refresh} />
      ))}
      {list.data && actions.length === 0 ? <Body muted>No discipline actions.</Body> : null}

      {open ? (
        <View style={styles.form}>
          <ChoiceChips<DisciplineActionType> label="Action" options={TYPE_OPTIONS} value={type} onChange={setType} />
          {type !== "WARNING" ? (
            <DateBoxes
              label={type === "DETENTION" ? "Day of the detention" : "First day"}
              value={start}
              onChange={setStart}
              error={type === "SUSPENSION" ? null : dateError}
            />
          ) : null}
          {type === "SUSPENSION" ? <DateBoxes label="Last day" value={end} onChange={setEnd} error={dateError} /> : null}
          <TextField
            label="Reason (staff only)"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={DISCIPLINE_REASON_MAX}
            autoCapitalize="sentences"
          />
          <View style={styles.buttons}>
            <Button title="Propose" loading={propose.isPending} disabled={reason.trim() === ""} onPress={submit} />
            <Button title="Cancel" variant="secondary" disabled={propose.isPending} onPress={() => setOpen(false)} />
          </View>
        </View>
      ) : (
        <Button title="Propose an action" variant="secondary" onPress={() => setOpen(true)} />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs, paddingVertical: spacing.sm },
  form: { gap: spacing.sm },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
