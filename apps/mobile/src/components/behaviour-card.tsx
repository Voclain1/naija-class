import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BEHAVIOUR_NOTE_MAX, type BehaviourKind, type BehaviourRecordDto } from "@school-kit/types";

import {
  createStaffBehaviour,
  staffBehaviour,
  withdrawStaffBehaviour,
} from "../lib/api/staff-behaviour";
import { queryKeys } from "../lib/query/keys";
import { serverToday } from "../lib/staff/server-date";
import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { ChoiceChips, TextField } from "./form";
import { Skeleton } from "./layout";
import { Body, Button, Card, Heading, Label, Notice } from "./ui";

// One child's behaviour record (docs/modules/the-school-day.md Part C), on the
// staff student page — where a teacher already is when they need it.
//
// C14: internal. Nothing on any family surface renders this component, and no
// endpoint exists that would let one.
//
// C16: commendations first in the chip order, deliberately. A system that
// records only what a child did wrong is one teachers stop using and parents
// rightly resent, and the order of two buttons is a quiet argument about what
// the feature is for.

const KIND_OPTIONS: readonly { value: BehaviourKind; label: string }[] = [
  { value: "COMMENDATION", label: "Commendation" },
  { value: "CONCERN", label: "Concern" },
];

function when(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function BehaviourCard({
  studentId,
  schoolId,
  userId,
  enabled,
}: {
  studentId: string;
  schoolId: string;
  userId: string;
  /** False while the session is not ready, or the viewer cannot read these. */
  enabled: boolean;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<BehaviourKind>("COMMENDATION");
  const [note, setNote] = useState("");

  const key = queryKeys.staffBehaviour(schoolId, userId, studentId);
  const list = useQuery({
    queryKey: key,
    queryFn: () => staffBehaviour(studentId),
    enabled,
    staleTime: 60_000,
  });

  const occurredOn = serverToday() ?? new Date().toISOString().slice(0, 10);

  const save = useMutation({
    mutationFn: () => createStaffBehaviour({ studentId, kind, note: note.trim(), occurredOn }),
    onSuccess: () => {
      setNote("");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: () => Alert.alert("Not saved", "We couldn't save that. Check your connection and try again."),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawStaffBehaviour(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: () => Alert.alert("Not withdrawn", "We couldn't withdraw that. Try again in a moment."),
  });

  function confirmWithdraw(item: BehaviourRecordDto): void {
    Alert.alert(
      "Withdraw this record?",
      "It stays on the record as withdrawn rather than disappearing — that it was written and taken back is part of the history.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Withdraw", style: "destructive", onPress: () => withdraw.mutate(item.id) },
      ],
    );
  }

  if (!enabled) return null;

  const data = list.data;

  return (
    <Card>
      <View style={styles.head}>
        <Heading>Behaviour</Heading>
        {data ? (
          <Label>
            {data.commendations} commendation{data.commendations === 1 ? "" : "s"} · {data.concerns} concern
            {data.concerns === 1 ? "" : "s"}
          </Label>
        ) : null}
      </View>

      {/* Said plainly, on the screen, because a teacher deciding how frankly to
          write needs to know who can read it. */}
      <Label>Staff only. Parents do not see these.</Label>

      {list.isPending ? (
        <Skeleton lines={2} />
      ) : list.isError && !data ? (
        <Notice tone="danger">We couldn&apos;t load this record.</Notice>
      ) : (data?.data.length ?? 0) === 0 ? (
        <Body muted>Nothing recorded yet.</Body>
      ) : (
        data!.data.map((item) => {
          const withdrawn = item.withdrawnAt !== null;
          return (
            <View key={item.id} style={[styles.row, { borderLeftColor: item.kind === "CONCERN" ? colors.danger : colors.primary }]}>
              <View style={styles.rowHead}>
                <Text
                  style={[
                    styles.kind,
                    {
                      color: withdrawn ? colors.mutedForeground : item.kind === "CONCERN" ? colors.danger : colors.primary,
                      textDecorationLine: withdrawn ? "line-through" : "none",
                    },
                  ]}
                >
                  {item.kind === "CONCERN" ? "Concern" : "Commendation"}
                </Text>
                <Label>{when(item.occurredOn)}</Label>
              </View>
              <Body muted={withdrawn}>{item.note}</Body>
              <Label>
                {item.recordedByName ?? "Staff"}
                {withdrawn ? " · withdrawn" : ""}
              </Label>
              {!withdrawn && (
                <Button title="Withdraw" variant="secondary" onPress={() => confirmWithdraw(item)} />
              )}
            </View>
          );
        })
      )}

      {open ? (
        <View style={styles.form}>
          <ChoiceChips label="What kind" options={KIND_OPTIONS} value={kind} onChange={setKind} />
          <TextField
            label="What happened"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={BEHAVIOUR_NOTE_MAX}
            placeholder="Write it as you would say it to a colleague."
            autoCapitalize="sentences"
          />
          <Label>Recorded as happening today ({when(occurredOn)}).</Label>
          <Button
            title={save.isPending ? "Saving…" : "Save record"}
            onPress={() => save.mutate()}
            disabled={note.trim() === "" || save.isPending}
          />
          <Button title="Cancel" variant="secondary" onPress={() => setOpen(false)} />
        </View>
      ) : (
        <Button title="Record behaviour" variant="secondary" onPress={() => setOpen(true)} />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm },
  row: { borderLeftWidth: 3, paddingLeft: spacing.sm, gap: spacing.xs, marginTop: spacing.sm },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  kind: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption },
  form: { gap: spacing.sm, marginTop: spacing.sm, borderRadius: radii.sm },
});
