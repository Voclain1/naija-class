import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttendanceRegisterRowDto, AttendanceStatusDto } from "@school-kit/types";

import { staffAttendanceRegister, staffMarkAttendance } from "../../../src/lib/api/staff-attendance";
import { ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { serverToday } from "../../../src/lib/staff/server-date";
import { markingBlockMessage, markingWindow } from "../../../src/lib/staff/marking-window";
import { useTheme } from "../../../src/theme/theme-provider";
import { spacing } from "../../../src/theme/tokens";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../../src/components/ui";

// The day's register for one arm.
//
// Three deliberate properties, each a rule from the plan-first rather than a
// UI preference:
//
//   1. NO optimistic write and NO offline queue. A staff write either reaches
//      the server and is confirmed, or it visibly failed. On failure the local
//      edits are KEPT (so the teacher does not lose ten taps) but nothing is
//      redrawn as saved, and the message distinguishes "never left the phone"
//      (ApiNetworkError) from "the server refused it" (ApiError).
//
//   2. DIRTY ROWS ONLY on submit, matching the web teacher surface. Sending
//      untouched rows would rewrite markedBy/markedAt for students this
//      teacher never looked at.
//
//   3. Amending is normal but never silent — an already-marked register says
//      so, with the time it was last saved.

const STATUSES: AttendanceStatusDto[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
const SHORT: Record<AttendanceStatusDto, string> = {
  PRESENT: "P",
  ABSENT: "A",
  LATE: "L",
  EXCUSED: "E",
};

function lastMarkedLabel(records: AttendanceRegisterRowDto[]): string | null {
  const stamps = records
    .map((r) => (r.markedAt ? new Date(r.markedAt).getTime() : null))
    .filter((n): n is number => n !== null && !Number.isNaN(n));
  if (stamps.length === 0) return null;
  const latest = new Date(Math.max(...stamps));
  const hh = String(latest.getHours()).padStart(2, "0");
  const mm = String(latest.getMinutes()).padStart(2, "0");
  return hh + ":" + mm;
}

export default function RegisterScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { armId } = useLocalSearchParams<{ armId: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";

  // The date is fixed to the SERVER's today for CP2 (see marking-window.ts —
  // temporary rail, not D14's answer). Read per render rather than held in
  // state so a register left open across midnight cannot keep writing to
  // yesterday under a stale value.
  const today = serverToday();
  const date = today ?? "";

  const [edits, setEdits] = useState<Record<string, AttendanceStatusDto>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const register = useQuery({
    queryKey: queryKeys.staffRegister(schoolId, userId, armId ?? "", date),
    queryFn: () => staffAttendanceRegister(armId as string, date),
    enabled: authed && schoolId !== "" && userId !== "" && !!armId && date !== "",
    staleTime: 0,
  });

  const records = useMemo(() => register.data?.records ?? [], [register.data]);

  // A row is dirty only if the teacher's choice differs from what loaded.
  const dirty = useMemo(
    () =>
      records.flatMap((r) => {
        const chosen = edits[r.studentId];
        if (chosen === undefined || chosen === r.status) return [];
        return [{ studentId: r.studentId, status: chosen }];
      }),
    [records, edits],
  );

  const window = markingWindow(date, today);

  const mark = useMutation({
    mutationFn: () => staffMarkAttendance({ classArmId: armId as string, date, records: dirty }),
    onSuccess: async (result) => {
      setFailure(null);
      setSaved(result.count);
      setEdits({});
      // Re-read rather than patch the cache: the server owns markedBy/markedAt
      // and the authoritative status, and a locally synthesised row would be a
      // guess presented as a confirmation.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.staffRegister(schoolId, userId, armId ?? "", date),
      });
    },
    onError: (error: unknown) => {
      setSaved(null);
      setFailure(
        error instanceof ApiNetworkError
          ? "Not saved. Your phone could not reach the server, so nothing was recorded. Try again when you have signal."
          : error instanceof Error && error.message
            ? "Not saved. " + error.message
            : "Not saved. The server refused this register.",
      );
    },
  });

  const setStatus = useCallback((studentId: string, next: AttendanceStatusDto) => {
    setSaved(null);
    setEdits((prev) => ({ ...prev, [studentId]: next }));
  }, []);

  const markAllPresent = useCallback(() => {
    setSaved(null);
    setEdits((prev) => {
      const next = { ...prev };
      for (const r of records) next[r.studentId] = "PRESENT";
      return next;
    });
  }, [records]);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const stamp = lastMarkedLabel(records);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Register" }} />
      <Heading>{date || "Today"}</Heading>
      {stamp ? (
        <Body muted>Already marked. Last saved at {stamp} — saving again updates it.</Body>
      ) : (
        <Body muted>Not marked yet today.</Body>
      )}

      {!window.canMark && window.reason && (
        <Notice tone="warning">{markingBlockMessage(window.reason)}</Notice>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {register.isPending && (
          <CenteredMessage>
            <Body muted>Loading the register…</Body>
          </CenteredMessage>
        )}

        {register.isError && !register.data && (
          <CenteredMessage>
            <Notice tone="danger">
              We could not load this register. It may not be yours to mark.
            </Notice>
            <Button title="Try again" variant="secondary" onPress={() => void register.refetch()} />
          </CenteredMessage>
        )}

        {register.data && records.length === 0 && (
          <Notice tone="info">No students are enrolled in this class for today.</Notice>
        )}

        {records.map((row) => {
          const current = edits[row.studentId] ?? row.status;
          return (
            <Card key={row.studentId} style={styles.row}>
              <View style={styles.rowText}>
                <Body>{row.fullName}</Body>
                <Label>{row.admissionNumber}</Label>
              </View>
              <View style={styles.statuses}>
                {STATUSES.map((s) => {
                  const active = current === s;
                  return (
                    <Pressable
                      key={s}
                      accessibilityRole="button"
                      accessibilityLabel={row.fullName + " " + s}
                      accessibilityState={{ selected: active }}
                      disabled={!window.canMark || mark.isPending}
                      onPress={() => setStatus(row.studentId, s)}
                      style={[
                        styles.chip,
                        {
                          borderColor: colors.primary,
                          backgroundColor: active ? colors.primary : "transparent",
                          opacity: !window.canMark || mark.isPending ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? colors.primaryForeground : colors.primary },
                        ]}
                      >
                        {SHORT[s]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          );
        })}
      </ScrollView>

      {failure !== null ? <Notice tone="danger">{failure}</Notice> : null}
      {saved !== null && (
        <Notice tone="info">
          Saved {saved} student{saved === 1 ? "" : "s"}.
        </Notice>
      )}
      {dirty.length > 0 && (
        <Body muted>
          {dirty.length} unsaved change{dirty.length === 1 ? "" : "s"}.
        </Body>
      )}

      <View style={styles.actions}>
        <Button
          title="All present"
          variant="secondary"
          disabled={!window.canMark || mark.isPending || records.length === 0}
          onPress={markAllPresent}
        />
        <Button
          title="Save register"
          loading={mark.isPending}
          disabled={!window.canMark || dirty.length === 0}
          onPress={() => mark.mutate()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingVertical: spacing.md },
  row: { gap: spacing.sm },
  rowText: { gap: spacing.xs },
  statuses: { flexDirection: "row", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minWidth: 44,
    alignItems: "center",
  },
  chipText: { fontWeight: "600" },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
});
