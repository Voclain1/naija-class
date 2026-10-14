import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  QUESTION_ANSWER_GUIDE_MAX,
  QUESTION_DIFFICULTIES,
  QUESTION_OPTIONS_MAX,
  QUESTION_OPTIONS_MIN,
  QUESTION_OPTION_TEXT_MAX,
  QUESTION_TEXT_MAX,
  QUESTION_TOPIC_MAX,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type QuestionDto,
} from "@school-kit/types";

import { createStaffQuestion, staffQuestion, updateStaffQuestion } from "../../../src/lib/api/staff-questions";
import { ApiError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import {
  OPTION_LETTERS,
  addOption,
  emptyQuestionForm,
  formToInput,
  questionToForm,
  removeOption,
  type QuestionFormResult,
  type QuestionFormValues,
} from "../../../src/lib/staff/question-form";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import { Button, Card, Notice, Screen } from "../../../src/components/ui";
import { ScreenHeader, Skeleton } from "../../../src/components/layout";
import { ChoiceChips, FieldError, TextField } from "../../../src/components/form";
import { LoadError } from "../../../src/components/load-error";

// Write or edit one question (Phase 8c / CP5b) — apps/web's
// QuestionEditorDialog as a screen. The rules and the words come from
// src/lib/staff/question-form.ts, ported from the web, which uses the same
// findQuestionContentError the API enforces: the form refuses exactly what the
// server would.
//
// Editing an APPROVED question does not change it: the API saves a new draft
// that replaces it once approved. The screen says so before the teacher types,
// because "I edited it and the paper still shows the old wording" would
// otherwise read as a bug.
//
// Params: `levelId` and `subjectId` (where a new question goes), and `id` when
// editing an existing one.

const DIFFICULTY_LABELS = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" } as const;

type Problem = Extract<QuestionFormResult, { ok: false }>;

export default function QuestionEditorScreen() {
  const { status, principal, staff } = useSession();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string; levelId?: string; subjectId?: string }>();
  const id = typeof params.id === "string" && params.id !== "" ? params.id : null;
  const levelId = typeof params.levelId === "string" ? params.levelId : "";
  const subjectId = typeof params.subjectId === "string" ? params.subjectId : "";

  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const canWrite = hasPermission(staff?.permissions ?? [], "question.write");
  const ready = authed && schoolId !== "" && userId !== "" && canWrite;

  const existing = useQuery({
    queryKey: queryKeys.staffQuestions(schoolId, userId, `one|${id ?? ""}`),
    queryFn: () => staffQuestion(id!),
    enabled: ready && id !== null,
  });

  const [form, setForm] = useState<QuestionFormValues>(() => emptyQuestionForm());
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Fill the form once, when the question arrives — never again, or a
  // background refetch would wipe what the teacher has typed.
  useEffect(() => {
    if (existing.data && loadedId !== existing.data.id) {
      setForm(questionToForm(existing.data));
      setLoadedId(existing.data.id);
    }
  }, [existing.data, loadedId]);

  const question: QuestionDto | null = id ? (existing.data ?? null) : null;
  const isApproved = question?.status === "APPROVED";

  const save = useMutation({
    mutationFn: async (input: Extract<QuestionFormResult, { ok: true }>["input"]) => {
      if (question) return updateStaffQuestion(question.id, input);
      return createStaffQuestion({ ...input, classLevelId: levelId, subjectId });
    },
    onMutate: () => setServerError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.staffQuestions(schoolId, userId, "").slice(0, 4) });
      Alert.alert("Saved", isApproved ? "Saved as a new draft for approval." : "Draft saved.");
      router.back();
    },
    onError: (error) =>
      setServerError(
        error instanceof ApiError && error.message
          ? error.message
          : "Couldn't save the question. Check your connection and try again.",
      ),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;
  const title = id ? (isApproved ? "Revise question" : "Edit draft") : "Write a question";

  if (!canWrite) {
    return (
      <Screen>
        {header}
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title={title} />
          <Notice tone="info">Your role can&apos;t write questions. Ask your school administrator if you need to.</Notice>
        </ScrollView>
      </Screen>
    );
  }

  if (id && (existing.isPending || existing.isError)) {
    return (
      <Screen>
        {header}
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title={title} />
          {existing.isError ? (
            <LoadError error={existing.error} what="this question" onRetry={() => void existing.refetch()} />
          ) : (
            <Skeleton lines={6} />
          )}
        </ScrollView>
      </Screen>
    );
  }

  if (!id && (!levelId || !subjectId)) {
    return (
      <Screen>
        {header}
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title={title} />
          <Notice tone="info">Choose a class and subject in the question bank first.</Notice>
        </ScrollView>
      </Screen>
    );
  }

  const set = <K extends keyof QuestionFormValues>(key: K, value: QuestionFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const fieldError = (field: Problem["field"]) => (problem?.field === field ? problem.message : null);

  function submit(): void {
    const result = formToInput(form);
    if (!result.ok) {
      setProblem(result);
      return;
    }
    setProblem(null);
    save.mutate(result.input);
  }

  const isMcq = form.type === "MULTIPLE_CHOICE";

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title={title}
            subtitle={question ? `${question.classLevelName} ${question.subjectName}` : null}
          />
          <Notice tone={isApproved ? "warning" : "info"}>
            {isApproved
              ? "This question is approved, so your changes are saved as a new draft. The approved version stays in use until the draft is approved."
              : "Saved as a draft. It can be used in a paper once the subject teacher or an admin approves it."}
          </Notice>

          <Card>
            <ChoiceChips
              label="Type"
              options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABELS[t] }))}
              value={form.type}
              onChange={(next) => set("type", next)}
            />
            <ChoiceChips
              label="Difficulty"
              options={QUESTION_DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))}
              value={form.difficulty}
              onChange={(next) => set("difficulty", next)}
            />
            <TextField
              label="Marks"
              value={form.marks}
              onChangeText={(text) => set("marks", text)}
              keyboardType="number-pad"
              maxLength={3}
              error={fieldError("marks")}
            />
            <TextField
              label="Topic"
              value={form.topic}
              onChangeText={(text) => set("topic", text)}
              maxLength={QUESTION_TOPIC_MAX}
              autoCapitalize="sentences"
              error={fieldError("topic")}
            />
            <TextField
              label="Question"
              value={form.text}
              onChangeText={(text) => set("text", text)}
              multiline
              maxLength={QUESTION_TEXT_MAX}
              autoCapitalize="sentences"
              error={fieldError("text")}
            />
          </Card>

          {isMcq && (
            <Card>
              <Text style={[styles.legend, { color: colors.foreground }]}>Options — choose the correct answer</Text>
              {form.options.map((text, i) => {
                const letter = OPTION_LETTERS[i] ?? String(i + 1);
                const correct = form.correctIndex === i;
                return (
                  <View
                    key={i}
                    style={[styles.option, { backgroundColor: correct ? `${colors.primary}1F` : "transparent" }]}
                  >
                    <TextField
                      label={`Option ${letter}`}
                      value={text}
                      onChangeText={(next) => set("options", form.options.map((o, j) => (j === i ? next : o)))}
                      maxLength={QUESTION_OPTION_TEXT_MAX}
                      autoCapitalize="sentences"
                    />
                    <View style={styles.optionActions}>
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ checked: correct }}
                        accessibilityLabel={`Option ${letter} is correct`}
                        onPress={() => set("correctIndex", i)}
                        style={[
                          styles.smallButton,
                          { borderColor: colors.primary, backgroundColor: correct ? colors.primary : "transparent" },
                        ]}
                      >
                        <Text style={[styles.smallButtonText, { color: correct ? colors.primaryForeground : colors.primary }]}>
                          {correct ? "Correct" : "Mark correct"}
                        </Text>
                      </Pressable>
                      {form.options.length > QUESTION_OPTIONS_MIN && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove option ${letter}`}
                          onPress={() => setForm((f) => removeOption(f, i))}
                          style={[styles.smallButton, { borderColor: colors.border }]}
                        >
                          <Text style={[styles.smallButtonText, { color: colors.mutedForeground }]}>Remove</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}
              {form.options.length < QUESTION_OPTIONS_MAX && (
                <Button title="Add option" variant="secondary" onPress={() => setForm(addOption)} />
              )}
              <FieldError message={fieldError("options")} />
            </Card>
          )}

          <Card>
            <TextField
              label={isMcq ? "Why the answer is right (optional)" : "Expected answer / marking guide"}
              value={form.answerGuide}
              onChangeText={(text) => set("answerGuide", text)}
              multiline
              maxLength={QUESTION_ANSWER_GUIDE_MAX}
              autoCapitalize="sentences"
              error={fieldError("answerGuide")}
            />
          </Card>

          {problem && <Notice tone="danger">{problem.message}</Notice>}
          {serverError && <Notice tone="danger">{serverError}</Notice>}

          <Button
            title={isApproved ? "Save as new draft" : "Save draft"}
            loading={save.isPending}
            onPress={submit}
          />
          <Button title="Cancel" variant="secondary" disabled={save.isPending} onPress={() => router.back()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md },
  legend: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  option: { gap: spacing.sm, borderRadius: radii.md, padding: spacing.sm },
  optionActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  smallButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  smallButtonText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
});
