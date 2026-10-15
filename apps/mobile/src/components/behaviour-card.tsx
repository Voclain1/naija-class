import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BEHAVIOUR_NOTE_MAX, type BehaviourKind, type BehaviourRecordDto } from "@school-kit/types";

import {
  createStaffBehaviour,
  staffBehaviour,
  staffBehaviourSettings,
  withdrawStaffBehaviour,
} from "../lib/api/staff-behaviour";
import { queryKeys } from "../lib/query/keys";
import { serverToday } from "../lib/staff/server-date";
import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { ChoiceChips, TextField } from "./form";
import { Skeleton } from "./layout";
import { Body, Button, Caption, Card, Heading, Label, Notice } from "./ui";

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

/** "+2" or "−1" — a real minus sign, as on the website. */
export function signedPoints(points: number): string {
  return points > 0 ? `+${points}` : points < 0 ? `−${Math.abs(points)}` : "0";
}

/** No category is a real choice, so it is a chip of its own. */
const NO_CATEGORY = "none";

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
  const [categoryId, setCategoryId] = useState<string>(NO_CATEGORY);

  const key = queryKeys.staffBehaviour(schoolId, userId, studentId);
  // Phase 9 / CP2.1. A failure here hides the category chips; it never
  // blocks writing a record.
  const settings = useQuery({
    queryKey: queryKeys.staffBehaviourSettings(schoolId, userId),
    queryFn: staffBehaviourSettings,
    enabled,
    staleTime: 5 * 60_000,
  });
  const offered = settings.data?.pointsEnabled
    ? settings.data.categories.filter((c) => c.active && c.kind === kind)
    : [];
  const categoryOptions = [
    { value: NO_CATEGORY, label: "No category" },
    ...offered.map((c) => ({ value: c.id, label: `${c.name} (${signedPoints(c.points)})` })),
  ];
  const list = useQuery({
    queryKey: key,
    queryFn: () => staffBehaviour(studentId),
    enabled,
    staleTime: 60_000,
  });

  const occurredOn = serverToday() ?? new Date().toISOString().slice(0, 10);

  const save = useMutation({
    mutationFn: () =>
      createStaffBehaviour({
        studentId,
        kind,
        note: note.trim(),
        occurredOn,
        ...(categoryId !== NO_CATEGORY ? { categoryId } : {}),
      }),
    onSuccess: () => {
      setNote("");
      setCategoryId(NO_CATEGORY);
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
      {data && data.termPoints !== null ? (
        <Body>
          {signedPoints(data.termPoints)} point{Math.abs(data.termPoints) === 1 ? "" : "s"} this term
        </Body>
      ) : null}

      {/* Said plainly, on the screen, because a teacher deciding how frankly to
          write needs to know who can read it. */}
      <Caption>Staff only. Parents do not see these.</Caption>

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
            <View
              key={item.id}
              style={[
                styles.row,
                // The kind is a tinted background, never a coloured edge
                // (CLAUDE.md "Design system", 2026-10-02). A withdrawn record
                // no longer stands, so it carries no colour at all.
                withdrawn ? null : { backgroundColor: (item.kind === "CONCERN" ? colors.danger : colors.primary) + "0F" },
              ]}
            >
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
              {item.categoryName !== null ? (
                <Caption>
                  {item.categoryName}
                  {item.points !== null ? ` (${signedPoints(item.points)})` : ""}
                </Caption>
              ) : null}
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
          <ChoiceChips
            label="What kind"
            options={KIND_OPTIONS}
            value={kind}
            onChange={(next) => {
              setKind(next);
              setCategoryId(NO_CATEGORY);
            }}
          />
          {offered.length > 0 ? (
            <ChoiceChips label="Category" options={categoryOptions} value={categoryId} onChange={setCategoryId} />
          ) : null}
          <TextField
            label="What happened"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={BEHAVIOUR_NOTE_MAX}
            placeholder="Write it as you would say it to a colleague."
            autoCapitalize="sentences"
          />
          <Caption>Recorded as happening today ({when(occurredOn)}).</Caption>
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
  row: { gap: spacing.xs, marginTop: spacing.sm, padding: spacing.sm, borderRadius: radii.md },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  kind: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption },
  form: { gap: spacing.sm, marginTop: spacing.sm, borderRadius: radii.sm },
});
