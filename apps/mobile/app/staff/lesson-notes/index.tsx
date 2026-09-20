import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { staffTeacherScope } from "../../../src/lib/api/staff-attendance";
import {
  staffCreateLessonPlan,
  staffListLessonPlans,
} from "../../../src/lib/api/staff-lesson-plans";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import {
  EmptyState,
  ListRow,
  ScreenHeader,
  SectionHeader,
  Skeleton,
} from "../../../src/components/layout";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Label,
  Notice,
  Screen,
} from "../../../src/components/ui";

// CP7 (4) — lesson notes: make one, or open one you already made.
//
// Both on one screen deliberately, as on web: a teacher arriving here almost
// always wants to make one, and a separate "new" route would put a navigation
// step in front of the primary action.
//
// D25 IS THIS SCREEN'S MAIN JOB. Generation is a synchronous 10-30 s model
// call that the phone must hold open. So:
//
//   1. The warning is shown BEFORE the button is pressed, never after.
//   2. Cancel is offered throughout the wait, and says honestly that the
//      school may still be charged for work already done — a cancel implying a
//      refund it cannot deliver would be a lie.
//   3. Progress lines cycle so a long wait reads as work rather than a hang.
//
// None of that makes the request survive the OS killing the app. That is a
// real limit of the synchronous design and is why a queued variant is the next
// slice, not a nice-to-have.

const PROGRESS_LINES = [
  "Reading the topic and class level…",
  "Planning the lesson structure…",
  "Writing the teaching content…",
  "Designing activities for a large class…",
  "Preparing assessment questions and homework…",
  "Almost there…",
];

export default function LessonNotesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "";

  const scope = useQuery({
    queryKey: queryKeys.staffScope(schoolId, userId),
    queryFn: staffTeacherScope,
    enabled: ready,
    staleTime: 60_000,
  });

  const plans = useQuery({
    queryKey: queryKeys.staffLessonPlans(schoolId, userId),
    queryFn: staffListLessonPlans,
    enabled: ready,
    staleTime: 30_000,
  });

  const [topic, setTopic] = useState("");
  const [armId, setArmId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const generate = useMutation({
    mutationFn: (input: { classLevelId: string; subjectId: string; topic: string }) => {
      abort.current = new AbortController();
      return staffCreateLessonPlan(input, abort.current.signal);
    },
    onMutate: () => {
      setFailure(null);
      setProgress(0);
    },
    onSuccess: async (plan) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.staffLessonPlans(schoolId, userId),
      });
      setTopic("");
      router.push(`/staff/lesson-notes/${plan.id}`);
    },
    onError: (error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        setFailure(
          "Stopped. The note was not saved — but the school may still have been charged for the work already done.",
        );
        return;
      }
      if (error instanceof ApiNetworkError) {
        setFailure(
          "Your phone lost the connection before the note came back. Nothing was saved. Try again on a steadier network.",
        );
        return;
      }
      setFailure(
        error instanceof ApiError
          ? error.message || "The note could not be written."
          : "The note could not be written. Please try again.",
      );
    },
    onSettled: () => {
      abort.current = null;
    },
  });

  // Cycle the progress lines only while a generation is actually running.
  useEffect(() => {
    if (!generate.isPending) return;
    const timer = setInterval(() => {
      setProgress((index) => Math.min(index + 1, PROGRESS_LINES.length - 1));
    }, 5000);
    return () => clearInterval(timer);
  }, [generate.isPending]);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const arms = scope.data?.classArms ?? [];
  const subjects = armId ? (scope.data?.subjectsByArm[armId] ?? []) : [];
  const selectedArm = arms.find((arm) => arm.id === armId) ?? null;
  const canGenerate =
    !generate.isPending &&
    topic.trim().length >= 3 &&
    selectedArm !== null &&
    subjectId !== null;

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScreenHeader title="Lesson notes" subtitle="Write a note with AI, then edit it" />

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {generate.isPending ? (
            <Card style={styles.waiting}>
              <Body>Writing your lesson note…</Body>
              <Body muted>{PROGRESS_LINES[progress]}</Body>
              <Notice tone="warning">
                Keep this screen open. Do not switch to another app or lock your phone until the
                note appears, or the work will be lost.
              </Notice>
              <Button
                title="Stop"
                variant="secondary"
                onPress={() => abort.current?.abort()}
              />
              <Label>
                Stopping may still cost your school for the work already done.
              </Label>
            </Card>
          ) : (
            <Card style={styles.form}>
              <Body>New lesson note</Body>

              <Label>Class</Label>
              <View style={styles.chips}>
                {arms.map((arm) => {
                  const active = arm.id === armId;
                  return (
                    <Pressable
                      key={arm.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        setArmId(arm.id);
                        setSubjectId(null);
                      }}
                      style={[
                        styles.chip,
                        {
                          borderColor: colors.primary,
                          backgroundColor: active ? colors.primary : "transparent",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? colors.primaryForeground : colors.primary },
                        ]}
                      >
                        {arm.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {armId ? (
                <>
                  <Label>Subject</Label>
                  {subjects.length === 0 ? (
                    <Body muted>You teach no subject in that class.</Body>
                  ) : (
                    <View style={styles.chips}>
                      {subjects.map((subject) => {
                        const active = subject.id === subjectId;
                        return (
                          <Pressable
                            key={subject.id}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            onPress={() => setSubjectId(subject.id)}
                            style={[
                              styles.chip,
                              {
                                borderColor: colors.primary,
                                backgroundColor: active ? colors.primary : "transparent",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                { color: active ? colors.primaryForeground : colors.primary },
                              ]}
                            >
                              {subject.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </>
              ) : null}

              <Label>Topic</Label>
              <TextInput
                value={topic}
                onChangeText={(text) => {
                  setFailure(null);
                  setTopic(text);
                }}
                placeholder="e.g. Photosynthesis"
                placeholderTextColor={colors.mutedForeground}
                maxLength={200}
                accessibilityLabel="Lesson topic"
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
              />

              {/* D25: the warning comes BEFORE the button, not after it. */}
              <Notice tone="warning">
                Writing a note takes up to half a minute. Once you start, keep this screen open —
                if you switch apps or your phone locks, the note can be lost and your school may
                still be charged. You can stop it yourself at any time.
              </Notice>

              <Button
                title="Write the note"
                disabled={!canGenerate}
                onPress={() =>
                  generate.mutate({
                    classLevelId: selectedArm!.classLevelId,
                    subjectId: subjectId!,
                    topic: topic.trim(),
                  })
                }
              />
              {topic.trim().length > 0 && topic.trim().length < 3 ? (
                <Label>Give the topic at least three letters.</Label>
              ) : null}
            </Card>
          )}

          {failure ? <Notice tone="danger">{failure}</Notice> : null}

          <SectionHeader title="Your notes" />

          {plans.isPending && <Skeleton lines={2} />}

          {plans.isError && !plans.data && (
            <CenteredMessage>
              <Notice tone="danger">We couldn&apos;t load your notes. Try again shortly.</Notice>
              <Button title="Try again" variant="secondary" onPress={() => void plans.refetch()} />
            </CenteredMessage>
          )}

          {plans.data && plans.data.length === 0 && (
            <EmptyState
              icon="document-text-outline"
              title="No notes yet"
              body="Choose a class, a subject and a topic above, and the app will write the first draft for you."
            />
          )}

          {(plans.data ?? []).map((plan) => (
            <ListRow
              key={plan.id}
              icon="document-text-outline"
              title={plan.topic}
              subtitle={`${plan.subjectName} · ${plan.classLevelName}`}
              onPress={() => router.push(`/staff/lesson-notes/${plan.id}`)}
            />
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, paddingVertical: spacing.md },
  form: { gap: spacing.sm },
  waiting: { gap: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: "center",
  },
  chipText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  planCard: { gap: spacing.sm },
  planText: { gap: spacing.xs },
});
