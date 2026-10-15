import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SICKBAY_LIMITS,
  formatSickbayDay,
  formatSickbayTime,
  sickbayDayOf,
  sickbayMomentFrom,
  type SickbayVisitDto,
} from "@school-kit/types";

import { ApiError } from "../lib/api/client";
import { recordStaffSickbayVisit, staffSickbayVisits, withdrawStaffSickbayVisit } from "../lib/api/staff-health";
import { queryKeys } from "../lib/query/keys";
import { useTheme } from "../theme/theme-provider";
import { spacing } from "../theme/tokens";
import { ChoiceChips, TextField } from "./form";
import { Body, Button, Caption, Card, Label } from "./ui";

// Phase 9 / CP3.3 — one child's sickbay visits in the staff app
// (docs/modules/phase-9.md §10 CP3-D5). sickbay.manage only: owner, admin and
// the Health officer. Visits are recorded for today here; an earlier day, and
// medicine given later, are on the website's Sickbay page.

const YES_NO = [
  { value: "no", label: "No" },
  { value: "yes", label: "Yes" },
] as const;
type YesNo = (typeof YES_NO)[number]["value"];

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function noticeLine(n: SickbayVisitDto["notices"]): string {
  const total = n.push + n.sms + n.none;
  if (total === 0) return "No parent is linked to this child.";
  const told = [n.push ? `${n.push} by the app` : "", n.sms ? `${n.sms} by SMS` : ""].filter(Boolean);
  return [told.length ? `Parents told: ${told.join(", ")}.` : "", n.none ? `${n.none} not reachable.` : ""].filter(Boolean).join(" ");
}

function Visit({ v, onChanged }: { v: SickbayVisitDto; onChanged: (v: SickbayVisitDto) => void }) {
  const { colors } = useTheme();
  const withdrawn = v.withdrawnAt !== null;
  const withdraw = useMutation({
    mutationFn: () => withdrawStaffSickbayVisit(v.id),
    onSuccess: onChanged,
    onError: (e) => Alert.alert("Not withdrawn", message(e, "We couldn't withdraw that. Try again.")),
  });
  return (
    <View style={styles.visit}>
      <Body muted={withdrawn}>
        {formatSickbayTime(v.visitedAt)} · {formatSickbayDay(v.visitedAt)}
        {withdrawn ? " (withdrawn)" : ""}
      </Body>
      {v.sentHome ? (
        <View style={[styles.tag, { backgroundColor: `${colors.secondary}33` }]}>
          <Caption>Sent home</Caption>
        </View>
      ) : null}
      <Body>Complaint: {v.complaint}</Body>
      {v.actionTaken ? <Body>Action: {v.actionTaken}</Body> : null}
      {v.medications.map((m) => (
        <Body key={m.id}>
          Medicine: {m.name}, {m.dose}, at {formatSickbayTime(m.givenAt)}
        </Body>
      ))}
      <Caption>
        {v.shareWithParent ? "Details shared with the parent." : "Details not shared with the parent."} {noticeLine(v.notices)}
      </Caption>
      {!withdrawn ? (
        <View style={styles.buttons}>
          <Button
            title="Withdraw visit"
            variant="secondary"
            loading={withdraw.isPending}
            onPress={() =>
              Alert.alert("Withdraw this visit?", "It stays in the log, marked withdrawn, and the parent no longer sees it.", [
                { text: "Cancel", style: "cancel" },
                { text: "Withdraw", style: "destructive", onPress: () => withdraw.mutate() },
              ])
            }
          />
        </View>
      ) : null}
    </View>
  );
}

export function SickbayCard({
  schoolId,
  userId,
  studentId,
}: {
  schoolId: string;
  userId: string;
  studentId: string;
}) {
  const queryClient = useQueryClient();
  const key = queryKeys.staffSickbayVisits(schoolId, userId, studentId);
  const visits = useQuery({ queryKey: key, queryFn: () => staffSickbayVisits(studentId), enabled: studentId !== "" });

  const [open, setOpen] = useState(false);
  const [time, setTime] = useState("");
  const [timeError, setTimeError] = useState<string | null>(null);
  const [complaint, setComplaint] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [medicine, setMedicine] = useState("");
  const [dose, setDose] = useState("");
  const [sentHome, setSentHome] = useState<YesNo>("no");
  const [share, setShare] = useState<YesNo>("no");

  const replace = (next: SickbayVisitDto) =>
    queryClient.setQueryData(key, (old: { data: SickbayVisitDto[] } | undefined) => ({
      data: old ? old.data.map((x) => (x.id === next.id ? next : x)) : [next],
    }));

  const record = useMutation({
    mutationFn: (visitedAt: string) =>
      recordStaffSickbayVisit({
        studentId,
        visitedAt,
        complaint: complaint.trim(),
        ...(actionTaken.trim() ? { actionTaken: actionTaken.trim() } : {}),
        sentHome: sentHome === "yes",
        shareWithParent: share === "yes",
        medications: medicine.trim() ? [{ name: medicine.trim(), dose: dose.trim(), givenAt: visitedAt }] : [],
      }),
    onSuccess: (created) => {
      queryClient.setQueryData(key, (old: { data: SickbayVisitDto[] } | undefined) => ({ data: [created, ...(old?.data ?? [])] }));
      setOpen(false);
      setComplaint("");
      setActionTaken("");
      setMedicine("");
      setDose("");
      setSentHome("no");
      setShare("no");
    },
    onError: (e) => Alert.alert("Not saved", message(e, "We couldn't save the visit. Check your connection and try again.")),
  });

  function start(): void {
    setTime(formatSickbayTime(new Date()));
    setTimeError(null);
    setOpen(true);
  }

  function submit(): void {
    const match = TIME.exec(time.trim());
    if (!match) {
      setTimeError("Enter the time like 10:40.");
      return;
    }
    if (medicine.trim() && !dose.trim()) {
      Alert.alert("Dose needed", "Enter the dose of the medicine, or clear its name.");
      return;
    }
    setTimeError(null);
    const hhmm = `${match[1]!.padStart(2, "0")}:${match[2]}`;
    record.mutate(sickbayMomentFrom(sickbayDayOf(new Date()), hhmm));
  }

  const list = visits.data?.data ?? [];

  return (
    <Card>
      <Label>Sickbay visits</Label>
      {visits.isLoading ? <Body muted>Loading…</Body> : null}
      {visits.isError ? <Body muted>We couldn&apos;t load the visits.</Body> : null}
      {visits.data && list.length === 0 ? <Body muted>No visits.</Body> : null}
      {list.map((v) => (
        <Visit key={v.id} v={v} onChanged={replace} />
      ))}
      {open ? (
        <View style={styles.form}>
          <TextField label="Time today" value={time} onChangeText={setTime} placeholder="10:40" maxLength={5} error={timeError} />
          <TextField
            label="Complaint"
            value={complaint}
            onChangeText={setComplaint}
            multiline
            maxLength={SICKBAY_LIMITS.complaint}
            autoCapitalize="sentences"
          />
          <TextField
            label="Action taken"
            value={actionTaken}
            onChangeText={setActionTaken}
            multiline
            maxLength={SICKBAY_LIMITS.actionTaken}
            autoCapitalize="sentences"
          />
          <TextField
            label="Medicine given (optional)"
            value={medicine}
            onChangeText={setMedicine}
            placeholder="For example, Paracetamol"
            maxLength={SICKBAY_LIMITS.medicationName}
            autoCapitalize="sentences"
          />
          {medicine.trim() ? (
            <TextField label="Dose" value={dose} onChangeText={setDose} placeholder="500 mg" maxLength={SICKBAY_LIMITS.dose} />
          ) : null}
          <ChoiceChips label="Sent home?" options={YES_NO} value={sentHome} onChange={setSentHome} />
          <ChoiceChips label="Share details with the parent?" options={YES_NO} value={share} onChange={setShare} />
          <Caption>
            Saving tells the child&apos;s parents in the app. An SMS goes only when the child is sent home, and it never names the
            complaint or the medicine. Without sharing, the parent sees only the time and whether the child was sent home.
          </Caption>
          <View style={styles.buttons}>
            <Button title="Save visit" loading={record.isPending} disabled={complaint.trim() === ""} onPress={submit} />
            <Button title="Cancel" variant="secondary" disabled={record.isPending} onPress={() => setOpen(false)} />
          </View>
        </View>
      ) : (
        <Button title="Record a visit" variant="secondary" onPress={start} />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  visit: { gap: spacing.xs, paddingVertical: spacing.xs },
  tag: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6 },
  form: { gap: spacing.sm },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
