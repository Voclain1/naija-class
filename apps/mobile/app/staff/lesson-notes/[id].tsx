import { useRef, useState, useSyncExternalStore } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LessonPlanDto, UpdateLessonPlanInput } from "@school-kit/types";

import {
  staffGenerateQuiz,
  staffGetLessonPlan,
  staffUpdateLessonPlan,
} from "../../../src/lib/api/staff-lesson-plans";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import {
  clearDraftCells,
  getGradebookDraftsVersion,
  lessonPlanDraftKey,
  readDraft,
  setDraftCell,
  subscribeGradebookDrafts,
} from "../../../src/lib/staff/gradebook-drafts";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
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

// CP7 (4) — one lesson note: read it, edit any section, add a quiz.
//
// Sections save ONE AT A TIME, which is the shape the API was built for (every
// field on PATCH is optional precisely so a per-section save is not a
// read-modify-write race). On a phone that also means a teacher can finish one
// section on the bus and leave the rest.
//
// D24: unsaved section text lives in the in-memory draft store, so the
// two-minute staff lock cannot discard a paragraph someone just wrote. It does
// NOT survive the app being closed, and the screen says so rather than letting
// a teacher assume otherwise.

type SectionKey = keyof Pick<
  LessonPlanDto,
  | "objectives"
  | "behaviouralObjectives"
  | "previousKnowledge"
  | "instructionalMaterials"
  | "mainContent"
  | "assessment"
  | "homework"
  | "conclusion"
  | "referenceMaterials"
  | "quiz"
>;

// Order follows a Nigerian lesson-note layout, which is what a head teacher
// signing it expects to read.
const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "objectives", label: "Objectives" },
  { key: "behaviouralObjectives", label: "Behavioural objectives" },
  { key: "previousKnowledge", label: "Previous knowledge" },
  { key: "instructionalMaterials", label: "Instructional materials" },
  { key: "mainContent", label: "Main content" },
  { key: "assessment", label: "Assessment" },
  { key: "homework", label: "Homework" },
  { key: "conclusion", label: "Conclusion" },
  { key: "referenceMaterials", label: "References" },
  { key: "quiz", label: "Quiz" },
];

function describeFailure(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Stopped. Nothing was saved — but the school may still have been charged for the work already done.";
  }
  if (error instanceof ApiNetworkError) {
    return "Your phone couldn't reach the server. Nothing was saved — try again when you have signal.";
  }
  if (error instanceof ApiError) return error.message || fallback;
  return fallback;
}

export default function LessonNoteScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "" && !!id;

  const planKey = queryKeys.staffLessonPlan(schoolId, userId, id ?? "");
  const plan = useQuery({
    queryKey: planKey,
    queryFn: () => staffGetLessonPlan(id as string),
    enabled: ready,
    staleTime: 30_000,
  });

  useSyncExternalStore(
    subscribeGradebookDrafts,
    getGradebookDraftsVersion,
    getGradebookDraftsVersion,
  );
  const draftsKey = ready ? lessonPlanDraftKey({ schoolId, userId, lessonPlanId: id as string }) : null;
  const drafts = draftsKey ? readDraft(draftsKey) : {};

  const [savingKey, setSavingKey] = useState<SectionKey | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const save = useMutation({
    mutationFn: (input: { key: SectionKey; text: string }) =>
      staffUpdateLessonPlan(id as string, { [input.key]: input.text } as UpdateLessonPlanInput),
    onMutate: (input) => {
      setSavingKey(input.key);
      setFailure(null);
      setNotice(null);
    },
    onSuccess: (updated, input) => {
      queryClient.setQueryData(planKey, updated);
      if (draftsKey) clearDraftCells(draftsKey, [input.key]);
      setNotice("Saved.");
    },
    onError: (error: unknown) => setFailure(describeFailure(error, "That section was not saved.")),
    onSettled: () => setSavingKey(null),
  });

  const quiz = useMutation({
    mutationFn: () => {
      abort.current = new AbortController();
      return staffGenerateQuiz(id as string, abort.current.signal);
    },
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(planKey, updated);
      setNotice("Quiz added at the bottom of the note.");
    },
    onError: (error: unknown) => setFailure(describeFailure(error, "The quiz could not be written.")),
    onSettled: () => {
      abort.current = null;
    },
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, title: "Lesson note" }} />;
  const notFound = plan.error instanceof ApiError && plan.error.status === 404;

  if (notFound) {
    return (
      <Screen>
        {header}
        <Notice tone="info">This lesson note no longer exists, or it isn&apos;t yours.</Notice>
      </Screen>
    );
  }

  if (plan.isPending || (plan.isError && !plan.data) || !plan.data) {
    return (
      <Screen>
        {header}
        <CenteredMessage>
          {plan.isError ? (
            <>
              <Notice tone="danger">We couldn&apos;t load this note. Try again shortly.</Notice>
              <Button title="Try again" variant="secondary" onPress={() => void plan.refetch()} />
            </>
          ) : (
            <Body muted>Loading the note…</Body>
          )}
        </CenteredMessage>
      </Screen>
    );
  }

  const data = plan.data;
  const grounding = data.groundedOn;
  const unsavedCount = Object.keys(drafts).length;

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Heading>{data.topic}</Heading>
        <Body muted>
          {data.subjectName} · {data.classLevelName}
          {data.durationMinutes ? ` · ${data.durationMinutes} minutes` : ""}
        </Body>

        {/* Where the content came from. A teacher signing a note deserves to
            know whether it was grounded in the school's own scheme of work. */}
        {grounding ? (
          <Label>
            {grounding.reason === "ok"
              ? // The model's own judgement, not the distance score: D38 records
                // that distance alone cannot tell a real match from a near one.
                grounding.modelSaysGrounded === false
                ? "Your scheme of work was searched, but it doesn't appear to cover this topic — check the note carefully."
                : "Written from your school's scheme of work."
              : grounding.reason === "no-documents"
                ? "No scheme of work uploaded, so this was written from the topic alone. You can upload one under Curriculum."
                : grounding.reason === "awaiting-review"
                  ? "Your scheme of work is uploaded but not approved yet, so this was written from the topic alone."
                  : grounding.reason === "not-configured"
                    ? "Written from the topic alone."
                    : "Written from the topic alone — no matching section was found in your scheme of work."}
          </Label>
        ) : null}

        {notice ? <Notice tone="info">{notice}</Notice> : null}
        {failure ? <Notice tone="danger">{failure}</Notice> : null}

        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          {SECTIONS.map((section) => {
            const saved = data[section.key] ?? "";
            const draft = drafts[section.key];
            const value = draft ?? saved;
            const edited = draft !== undefined && draft !== saved;
            const saving = savingKey === section.key;
            const isQuiz = section.key === "quiz";

            if (isQuiz && saved === "" && draft === undefined) {
              return (
                <Card key={section.key} style={styles.section}>
                  <Label>{section.label}</Label>
                  <Body muted>No quiz yet.</Body>
                  {quiz.isPending ? (
                    <>
                      <Notice tone="warning">
                        Keep this screen open. Do not switch apps or lock your phone until the quiz
                        appears, or the work will be lost.
                      </Notice>
                      <Button
                        title="Stop"
                        variant="secondary"
                        onPress={() => abort.current?.abort()}
                      />
                    </>
                  ) : (
                    <>
                      <Notice tone="warning">
                        Writing a quiz takes up to half a minute and needs this screen to stay
                        open. You can stop it yourself at any time.
                      </Notice>
                      <Button title="Write a quiz" onPress={() => quiz.mutate()} />
                    </>
                  )}
                </Card>
              );
            }

            return (
              <Card key={section.key} style={styles.section}>
                <View style={styles.sectionHead}>
                  <Label>{section.label}</Label>
                  {edited ? <Label>Unsaved</Label> : null}
                </View>
                <TextInput
                  value={value}
                  onChangeText={(text) => {
                    if (!draftsKey) return;
                    setFailure(null);
                    setNotice(null);
                    if (text === saved) {
                      clearDraftCells(draftsKey, [section.key]);
                      return;
                    }
                    setDraftCell(draftsKey, section.key, text);
                  }}
                  multiline
                  maxLength={20000}
                  editable={!saving}
                  placeholder={`Nothing written for ${section.label.toLowerCase()} yet.`}
                  placeholderTextColor={colors.mutedForeground}
                  accessibilityLabel={section.label}
                  style={[
                    styles.input,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.card,
                      borderColor: edited ? colors.warning : colors.border,
                    },
                  ]}
                />
                <Button
                  title={saving ? "Saving" : "Save this section"}
                  variant="secondary"
                  loading={saving}
                  disabled={saving || !edited}
                  onPress={() => save.mutate({ key: section.key, text: value })}
                />
              </Card>
            );
          })}
        </ScrollView>

        {unsavedCount > 0 ? (
          <Body muted>
            {unsavedCount} section{unsavedCount === 1 ? "" : "s"} not saved. Your writing stays if
            the app locks, but is lost if you close the app — save each section as you finish it.
          </Body>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: spacing.sm, paddingVertical: spacing.md },
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    textAlignVertical: "top",
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
});
