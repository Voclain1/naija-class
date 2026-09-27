import { useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  HOMEWORK_INSTRUCTIONS_MAX,
  HOMEWORK_TITLE_MAX,
  addDays,
  type HomeworkDto,
} from "@school-kit/types";

import {
  createStaffHomework,
  staffHomework,
  withdrawStaffHomework,
} from "../../../src/lib/api/staff-homework";
import { staffTeacherScope } from "../../../src/lib/api/staff-attendance";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { isSchoolAdmin } from "../../../src/lib/auth/roles";
import { serverToday } from "../../../src/lib/staff/server-date";
import { useTheme } from "../../../src/theme/theme-provider";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, Heading, Label, Notice, Screen } from "../../../src/components/ui";
import { EmptyState, ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";
import { ChoiceChips, TextField } from "../../../src/components/form";

// Setting homework, on the phone (docs/modules/the-school-day.md Part B).
//
// A teacher's own classes and subjects come from THEIR teacher scope — the same
// list the gradebook picker uses — so the phone cannot offer a class the server
// will refuse. The server re-checks anyway (B8): this picker is convenience,
// not the boundary.
//
// Due date is chosen as a day, not typed: "tomorrow" and "Friday" are what a
// teacher actually means, and a date field on a phone keyboard is how you get
// homework due in 2025.

const DUE_CHOICES = [
  { value: "1", label: "Tomorrow" },
  { value: "2", label: "In 2 days" },
  { value: "7", label: "Next week" },
] as const;

function when(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

export default function StaffHomeworkScreen() {
  const { status, principal, staff } = useSession();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "";
  const admin = isSchoolAdmin(staff?.roles);

  const [armId, setArmId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueIn, setDueIn] = useState<string>("1");

  const scope = useQuery({
    queryKey: queryKeys.staffScope(schoolId, userId),
    queryFn: staffTeacherScope,
    enabled: ready,
    staleTime: 10 * 60_000,
  });

  const list = useQuery({
    queryKey: queryKeys.staffHomework(schoolId, userId, armId ?? ""),
    queryFn: () => staffHomework(armId ?? undefined),
    enabled: ready,
    staleTime: 60_000,
  });

  const arms = scope.data?.classArms ?? [];
  // subjectsByArm is a plain object on the wire (the server builds a Map and
  // serialises it), so the subjects for a class are looked up by id rather
  // than nested under the arm.
  const subjects = useMemo(
    () => (armId ? (scope.data?.subjectsByArm[armId] ?? []) : []),
    [scope.data, armId],
  );

  const today = serverToday() ?? new Date().toISOString().slice(0, 10);
  const dueDate = addDays(today, Number(dueIn));

  const post = useMutation({
    mutationFn: () =>
      createStaffHomework({
        classArmId: armId ?? "",
        subjectId: subjectId ?? "",
        title: title.trim(),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        dueDate,
      }),
    onSuccess: () => {
      setTitle("");
      setInstructions("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.staffHomework(schoolId, userId, armId ?? "") });
      Alert.alert("Set", "The class and their parents can see it now.");
    },
    onError: () => Alert.alert("Not set", "We couldn't set that homework. Check your connection and try again."),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawStaffHomework(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.staffHomework(schoolId, userId, armId ?? "") });
    },
    onError: () => Alert.alert("Not withdrawn", "We couldn't withdraw that. Try again in a moment."),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const canPost = armId !== null && subjectId !== null && title.trim() !== "" && !post.isPending;

  function confirmWithdraw(item: HomeworkDto): void {
    Alert.alert(
      "Withdraw this homework?",
      `"${item.title}" stops showing to ${item.className} and their parents. It stays on your own list as withdrawn.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Withdraw", style: "destructive", onPress: () => withdraw.mutate(item.id) },
      ],
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Homework" }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={list.isRefetching}
              onRefresh={() => void list.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <ScreenHeader
            title="Homework"
            subtitle={admin ? "What the school has set." : "What you have set for your classes."}
          />

          <Card>
            <Heading>Set homework</Heading>
            {scope.isPending ? (
              <Skeleton lines={3} />
            ) : arms.length === 0 ? (
              <Notice tone="info">
                You have no classes assigned yet, so there is nothing to set homework for. Ask your school
                administrator.
              </Notice>
            ) : (
              <View style={styles.form}>
                <ChoiceChips
                  label="Class"
                  options={arms.map((arm) => ({ value: arm.id, label: arm.name }))}
                  value={armId}
                  onChange={(next) => {
                    setArmId(next);
                    // A subject chosen for the previous class is meaningless
                    // here and would be refused by the server.
                    setSubjectId(null);
                  }}
                />
                {armId !== null && (
                  <ChoiceChips
                    label="Subject"
                    options={subjects.map((subject) => ({ value: subject.id, label: subject.name }))}
                    value={subjectId}
                    onChange={setSubjectId}
                  />
                )}
                <TextField
                  label="What is it"
                  value={title}
                  onChangeText={setTitle}
                  maxLength={HOMEWORK_TITLE_MAX}
                  placeholder="Exercise 4, questions 1–10"
                  autoCapitalize="sentences"
                />
                <TextField
                  label="Instructions (optional)"
                  value={instructions}
                  onChangeText={setInstructions}
                  multiline
                  maxLength={HOMEWORK_INSTRUCTIONS_MAX}
                  placeholder="Show your working. Bring your exercise book."
                  autoCapitalize="sentences"
                />
                <ChoiceChips
                  label="Due"
                  options={DUE_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
                  value={dueIn}
                  onChange={setDueIn}
                />
                <Label>Due {when(`${dueDate}T00:00:00.000Z`)}</Label>
                <Button
                  title={post.isPending ? "Setting…" : "Set homework"}
                  onPress={() => post.mutate()}
                  disabled={!canPost}
                />
              </View>
            )}
          </Card>

          <SectionHeader title="Set recently" />
          {list.isPending ? (
            <Skeleton lines={4} />
          ) : list.isError && !list.data ? (
            <Notice tone="danger">We couldn&apos;t load the homework list.</Notice>
          ) : (list.data?.data.length ?? 0) === 0 ? (
            <EmptyState icon="book-outline" title="Nothing set yet" body="What you set appears here." />
          ) : (
            list.data!.data.map((item) => (
              <Card key={item.id}>
                <Heading>{item.title}</Heading>
                <Label>
                  {item.className} · {item.subjectName} · due {when(`${item.dueDate}T00:00:00.000Z`)}
                  {item.withdrawnAt ? " · withdrawn" : ""}
                </Label>
                {item.instructions ? <Body>{item.instructions}</Body> : null}
                {!item.withdrawnAt && (
                  <Button title="Withdraw" variant="secondary" onPress={() => confirmWithdraw(item)} />
                )}
              </Card>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md },
  form: { gap: spacing.sm, marginTop: spacing.sm },
});
