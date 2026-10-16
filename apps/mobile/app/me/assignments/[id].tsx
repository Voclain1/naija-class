import { useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ASSIGNMENT_LIMITS, describeWorkStatus, type MyAssignmentDto } from "@school-kit/types";

import { ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Button, Caption, Card, Label, Screen } from "../../../src/components/ui";
import { ApiError } from "../../../src/lib/api/client";
import { studentAssignment, submitStudentWork } from "../../../src/lib/api/student-portal";
import { useSession } from "../../../src/lib/auth/session";
import { countChange, type PasteCounts } from "../../../src/lib/family/paste-counter";
import { queryKeys } from "../../../src/lib/query/keys";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";

// Phase 9 / CP4.1 — a student hands in work their teacher is collecting
// (docs/modules/phase-9.md §11). A typed answer; once handed in it is final
// unless the teacher returns it. No AI help of any kind (Q6).
//
// The answer box counts typed and pasted characters (Q7). The student is told
// so; the teacher sees "about N% pasted"; it never changes a mark.
//
// Kept off the phone's storage: the answer and the mark stay in memory.

function formatDue(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function when(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
}

export default function HandInWorkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const homeworkId = typeof id === "string" ? id : "";
  const { status, principal } = useSession();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const authed = status === "authenticated" && principal === "student";
  const [text, setText] = useState("");
  const counts = useRef<PasteCounts>({ typed: 0, pasted: 0 });

  const query = useQuery({
    queryKey: queryKeys.myAssignment(homeworkId),
    queryFn: () => studentAssignment(homeworkId),
    enabled: authed && homeworkId !== "",
    meta: { persist: false },
  });

  const submit = useMutation({
    mutationFn: () =>
      submitStudentWork(homeworkId, {
        body: text.trim(),
        typedChars: counts.current.typed,
        pastedChars: counts.current.pasted,
      }),
    onSuccess: (next: MyAssignmentDto) => {
      queryClient.setQueryData(queryKeys.myAssignment(homeworkId), next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.myAssignments });
      setText("");
      counts.current = { typed: 0, pasted: 0 };
    },
    onError: (e) =>
      Alert.alert(
        "Not handed in",
        e instanceof ApiError ? e.message : "We couldn't hand it in. Check your connection and try again. Your answer is still here.",
      ),
  });

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") return <Redirect href="/students" />;

  const d = query.data;

  function onChange(next: string): void {
    counts.current = countChange(text, next, counts.current);
    setText(next);
  }

  function confirmSubmit(): void {
    Alert.alert("Hand it in?", "You can't change it after you hand it in, unless your teacher returns it to you.", [
      { text: "Not yet", style: "cancel" },
      { text: "Hand it in", onPress: () => submit.mutate() },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader title={d?.title ?? "Your work"} subtitle={d ? `${d.subjectName} · due ${formatDue(d.dueDate)}` : null} />
          {query.isLoading ? (
            <Skeleton lines={4} />
          ) : query.isError || !d ? (
            <LoadError error={query.error} what="this work" onRetry={() => void query.refetch()} />
          ) : (
            <>
              <Card>
                {d.instructions ? <Body>{d.instructions}</Body> : null}
                <Label>
                  {describeWorkStatus(d.status)} · out of {d.totalMarks}
                </Label>
              </Card>

              {d.canSubmit ? (
                <Card>
                  <Label>{d.status === "RETURNED" ? "Hand it in again" : "Your answer"}</Label>
                  <TextInput
                    value={text}
                    onChangeText={onChange}
                    multiline
                    maxLength={ASSIGNMENT_LIMITS.body}
                    autoCapitalize="sentences"
                    accessibilityLabel="Your answer"
                    placeholder="Write your answer here."
                    placeholderTextColor={colors.mutedForeground}
                    textAlignVertical="top"
                    style={[
                      styles.input,
                      { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
                    ]}
                  />
                  <Caption>
                    Your teacher sees how much of your answer was typed and how much was pasted. Write it in your own
                    words.
                  </Caption>
                  <Button
                    title="Hand it in"
                    loading={submit.isPending}
                    disabled={text.trim() === ""}
                    onPress={confirmSubmit}
                  />
                </Card>
              ) : d.status === "NOT_SUBMITTED" ? (
                <Card>
                  <Body muted>Your teacher has stopped accepting work for this.</Body>
                </Card>
              ) : null}

              {d.attempts.map((a) => (
                <Card key={a.attempt}>
                  <Label>
                    {d.attempts.length > 1 ? `Attempt ${a.attempt} · ` : ""}handed in {when(a.submittedAt)}
                    {a.late ? " · late" : ""}
                  </Label>
                  <View style={[styles.answer, { backgroundColor: `${colors.mutedForeground}14` }]}>
                    <Body>{a.body}</Body>
                  </View>
                  {a.returnNote ? <Caption>Returned by your teacher: {a.returnNote}</Caption> : null}
                  {a.mark !== null ? (
                    <Label>
                      Mark: {a.mark}/{d.totalMarks}
                    </Label>
                  ) : null}
                  {a.feedback ? <Body>{a.feedback}</Body> : null}
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, padding: spacing.md },
  input: {
    minHeight: 180,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  answer: { padding: spacing.sm, borderRadius: radii.sm },
});
