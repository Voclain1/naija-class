import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ASSIGNMENT_LIMITS,
  describeWorkStatus,
  optionLetter,
  type AssignmentMarkingDto,
  type AssignmentQuestionDto,
  type AssignmentRosterRowDto,
  type AssignmentSubmissionDto,
  type StudentWorkDto,
} from "@school-kit/types";

import { AiDraftCard, AiDraftPanel } from "../../../src/components/ai-draft";
import { AnswerList } from "../../../src/components/assignment-questions";
import { GradebookCard, SimilarityCard } from "../../../src/components/assignment-tools";
import { TextField } from "../../../src/components/form";
import { SubmissionFiles } from "../../../src/components/submission-files";
import { ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Button, Caption, Card, Label, Screen } from "../../../src/components/ui";
import { ApiError } from "../../../src/lib/api/client";
import {
  applyStaffAutoMarks,
  collectStaffWork,
  markStaffSubmission,
  releaseStaffMarks,
  returnStaffSubmission,
  staffAssignmentFileUrl,
  staffMarking,
  staffStudentWork,
} from "../../../src/lib/api/staff-homework";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { useTheme } from "../../../src/theme/theme-provider";
import { spacing } from "../../../src/theme/tokens";
import { WebsiteLink } from "../../../src/components/website-link";
import { isSchoolAdmin } from "../../../src/lib/auth/roles";

// Phase 9 / CP4.1 — handed-in work for one homework item, in the staff app
// (docs/modules/phase-9.md §11). Tap a student to read and mark their work.
// Marks reach the student and parents only after "Release marks". The paste
// figure (Q7) is shown to staff and nowhere else.
//
// CP4.3: each student's answers to the questions, right or wrong, with the
// automatic mark as the starting point. Questions are set on the website; the
// app shows them.

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
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

function Attempt({
  attempt,
  latest,
  totalMarks,
  questions,
  aiDrafting,
  onChanged,
  onReload,
}: {
  attempt: AssignmentSubmissionDto;
  latest: boolean;
  totalMarks: number;
  questions: AssignmentQuestionDto[];
  /** CP4b: the school has AI drafts switched on. */
  aiDrafting: boolean;
  onChanged: (work: StudentWorkDto) => void;
  onReload: () => void;
}) {
  const { colors } = useTheme();
  // An unmarked attempt starts from the automatic mark, when there is one.
  const [mark, setMark] = useState(
    attempt.mark !== null ? String(attempt.mark) : attempt.autoMark !== null ? String(attempt.autoMark) : "",
  );
  const [feedback, setFeedback] = useState(attempt.feedback ?? "");
  const [note, setNote] = useState("");
  const [returning, setReturning] = useState(false);
  // CP4b: the boxes were filled from an AI draft. Recorded when saved.
  const [fromDraft, setFromDraft] = useState(false);
  const canWork = latest && !attempt.returnedAt;

  const save = useMutation({
    mutationFn: (value: number) =>
      markStaffSubmission(attempt.id, {
        mark: value,
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
        ...(fromDraft ? { fromAiDraft: true } : {}),
      }),
    onSuccess: onChanged,
    onError: (e) => Alert.alert("Not saved", message(e, "We couldn't save the mark. Try again.")),
  });
  const send = useMutation({
    mutationFn: () => returnStaffSubmission(attempt.id, { note: note.trim() }),
    onSuccess: (w) => {
      setReturning(false);
      onChanged(w);
    },
    onError: (e) => Alert.alert("Not returned", message(e, "We couldn't return the work. Try again.")),
  });

  function submitMark(): void {
    const value = Number(mark);
    if (mark.trim() === "" || !Number.isInteger(value)) {
      Alert.alert("Mark needed", "Enter a whole-number mark.");
      return;
    }
    save.mutate(value);
  }

  return (
    <View style={styles.attempt}>
      <Label>
        Attempt {attempt.attempt} · {when(attempt.submittedAt)}
        {attempt.late ? " · late" : ""}
      </Label>
      {attempt.body ? (
        <>
          <View style={[styles.answer, { backgroundColor: `${colors.mutedForeground}14` }]}>
            <Body>{attempt.body}</Body>
          </View>
          <Caption>
            About {attempt.pastedPercent}% was pasted rather than typed, as the student&apos;s phone reported it. Not a
            judgement, and never part of the mark. The student and parents don&apos;t see it.
          </Caption>
        </>
      ) : null}
      {attempt.answers.length > 0 ? (
        <>
          <Label>
            Questions: {attempt.autoMark} of {questions.reduce((sum, q) => sum + q.marks, 0)}, marked automatically
          </Label>
          <AnswerList questions={questions} answers={attempt.answers} />
        </>
      ) : null}
      <SubmissionFiles files={attempt.files} getUrl={staffAssignmentFileUrl} />
      {attempt.returnedAt ? <Caption>Returned: {attempt.returnNote}</Caption> : null}
      {canWork && aiDrafting && !attempt.markedAt ? (
        <AiDraftPanel
          attempt={attempt}
          onChanged={onReload}
          onUse={(m, f) => {
            setMark(String(m));
            setFeedback(f);
            setFromDraft(true);
          }}
        />
      ) : null}
      {canWork ? (
        <>
          <TextField
            label={`Mark out of ${totalMarks}`}
            value={mark}
            onChangeText={setMark}
            keyboardType="number-pad"
            maxLength={4}
          />
          <TextField
            label="Feedback"
            value={feedback}
            onChangeText={setFeedback}
            multiline
            maxLength={ASSIGNMENT_LIMITS.feedback}
            autoCapitalize="sentences"
          />
          {attempt.markedAt ? (
            <Caption>
              Marked {attempt.mark}/{totalMarks}. {attempt.releasedAt ? "Released." : "Not released yet."}
            </Caption>
          ) : null}
          <View style={styles.buttons}>
            <Button title={attempt.markedAt ? "Update mark" : "Save mark"} loading={save.isPending} onPress={submitMark} />
            {!attempt.markedAt && !returning ? (
              <Button title="Return to student" variant="secondary" onPress={() => setReturning(true)} />
            ) : null}
          </View>
          {returning ? (
            <>
              <TextField
                label="What should the student change?"
                value={note}
                onChangeText={setNote}
                multiline
                maxLength={ASSIGNMENT_LIMITS.returnNote}
                autoCapitalize="sentences"
              />
              <View style={styles.buttons}>
                <Button title="Return work" loading={send.isPending} disabled={note.trim() === ""} onPress={() => send.mutate()} />
                <Button title="Cancel" variant="secondary" onPress={() => setReturning(false)} />
              </View>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function StudentWork({
  schoolId,
  userId,
  homeworkId,
  row,
  aiDrafting,
  onChanged,
}: {
  schoolId: string;
  userId: string;
  homeworkId: string;
  row: AssignmentRosterRowDto;
  aiDrafting: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const key = queryKeys.staffStudentWork(schoolId, userId, homeworkId, row.studentId);
  const work = useQuery({
    queryKey: key,
    queryFn: () => staffStudentWork(homeworkId, row.studentId),
    // CP4b: while a draft is being made, look again every few seconds.
    refetchInterval: (q) => (q.state.data?.attempts[0]?.draft?.status === "PENDING" ? 3000 : false),
  });
  if (work.isLoading) return <Body muted>Loading…</Body>;
  if (work.isError || !work.data) return <Body muted>We couldn&apos;t load the work.</Body>;
  if (work.data.attempts.length === 0) return <Body muted>Nothing handed in yet.</Body>;
  return (
    <>
      {work.data.attempts.map((a, i) => (
        <Attempt
          key={a.id}
          attempt={a}
          latest={i === 0}
          totalMarks={work.data.totalMarks}
          questions={work.data.questions}
          aiDrafting={aiDrafting}
          onReload={() => {
            void work.refetch();
            onChanged();
          }}
          onChanged={(next) => {
            queryClient.setQueryData(key, next);
            onChanged();
          }}
        />
      ))}
    </>
  );
}

export default function HandedInWorkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const homeworkId = typeof id === "string" ? id : "";
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const queryClient = useQueryClient();
  const key = queryKeys.staffAssignmentMarking(schoolId, userId, homeworkId);
  const [open, setOpen] = useState<string | null>(null);

  const marking = useQuery({
    queryKey: key,
    queryFn: () => staffMarking(homeworkId),
    enabled: authed && homeworkId !== "",
    // CP4b: while any AI draft is being made, look again every few seconds.
    refetchInterval: (q) => (q.state.data?.roster.some((r) => r.draftStatus === "PENDING") ? 4000 : false),
  });
  const settle = (next: AssignmentMarkingDto) => queryClient.setQueryData(key, next);
  const toggle = useMutation({
    mutationFn: (d: AssignmentMarkingDto) =>
      collectStaffWork(homeworkId, { totalMarks: d.collection.totalMarks, accepting: !d.collection.accepting }),
    onSuccess: settle,
    onError: (e) => Alert.alert("Not changed", message(e, "Try again in a moment.")),
  });
  const release = useMutation({
    mutationFn: () => releaseStaffMarks(homeworkId),
    onSuccess: settle,
    onError: (e) => Alert.alert("Not released", message(e, "Try again in a moment.")),
  });
  const autoMarks = useMutation({
    mutationFn: () => applyStaffAutoMarks(homeworkId),
    onSuccess: settle,
    onError: (e) => Alert.alert("Not marked", message(e, "Try again in a moment.")),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const d = marking.data;
  const unreleased = d ? d.roster.filter((r) => r.status === "MARKED" && !r.released).length : 0;
  const autoMarkable = d ? d.roster.filter((r) => r.status === "SUBMITTED" && r.autoMark !== null).length : 0;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader title={d?.title ?? "Handed-in work"} subtitle={d ? `${d.className} · ${d.subjectName}` : null} />
          {marking.isLoading ? (
            <Skeleton lines={4} />
          ) : marking.isError || !d ? (
            <LoadError error={marking.error} what="the handed-in work" onRetry={() => void marking.refetch()} />
          ) : (
            <>
              <Card>
                <Body>
                  {d.counts.submitted} to mark · {d.counts.marked} marked · {d.counts.released} released ·{" "}
                  {d.counts.notSubmitted} not handed in
                </Body>
                <Caption>
                  Out of {d.collection.totalMarks}.{" "}
                  {d.collection.accepting ? "Students can hand work in, late work included." : "Not accepting new work."}
                </Caption>
                <View style={styles.buttons}>
                  <Button
                    title={d.collection.accepting ? "Stop accepting work" : "Accept work again"}
                    variant="secondary"
                    loading={toggle.isPending}
                    onPress={() => toggle.mutate(d)}
                  />
                  <Button
                    title={unreleased === 0 ? "No new marks to release" : `Release ${unreleased} mark${unreleased === 1 ? "" : "s"}`}
                    disabled={unreleased === 0}
                    loading={release.isPending}
                    onPress={() =>
                      Alert.alert("Release marks?", "The students and their parents will see the mark and your feedback.", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Release", onPress: () => release.mutate() },
                      ])
                    }
                  />
                  {d.questions.length > 0 && autoMarkable > 0 ? (
                    <Button
                      title="Use automatic marks"
                      variant="secondary"
                      loading={autoMarks.isPending}
                      onPress={() =>
                        Alert.alert(
                          "Use automatic marks?",
                          "Only for work that is answers to the questions and nothing else. Work with a written answer or a file still needs you to mark it. Nothing is released until you release it.",
                          [
                            { text: "Cancel", style: "cancel" },
                            { text: "Use them", onPress: () => autoMarks.mutate() },
                          ],
                        )
                      }
                    />
                  ) : null}
                </View>
              </Card>
              {d.aiDrafting ? (
                <AiDraftCard
                  homeworkId={homeworkId}
                  data={d}
                  onChanged={(next) => (next ? settle(next) : void queryClient.invalidateQueries({ queryKey: key }))}
                />
              ) : null}
              {d.questions.length > 0 ? (
                <Card>
                  <Label>Questions</Label>
                  {/* CP11.2: questions are set on the website; open the right page, signed in. */}
                  <WebsiteLink
                    path={isSchoolAdmin(staff?.roles) ? `/homework/${homeworkId}` : `/teacher/homework/${homeworkId}`}
                    title="Add or change questions"
                    hint="Marked automatically when a student hands in. Add or change them on the website, before anyone hands in."
                  />
                  {d.questions.map((q) => (
                    <View key={q.id} style={styles.question}>
                      <Body>
                        {q.number}. {q.text} ({q.marks} mark{q.marks === 1 ? "" : "s"})
                      </Body>
                      <Caption>
                        {q.type === "MULTIPLE_CHOICE"
                          ? `Right answer: ${optionLetter(q.correctIndex ?? 0)}. ${q.options?.[q.correctIndex ?? 0] ?? ""}`
                          : `Accepted: ${(q.acceptedAnswers ?? []).join(" · ")}`}
                      </Caption>
                    </View>
                  ))}
                </Card>
              ) : null}
              {d.roster.map((row) => (
                <Card key={row.studentId}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open === row.studentId }}
                    onPress={() => setOpen(open === row.studentId ? null : row.studentId)}
                    style={styles.row}
                  >
                    <Body>{row.name}</Body>
                    <Caption>
                      {describeWorkStatus(row.status)}
                      {row.late ? " · late" : ""}
                      {row.mark !== null ? ` · ${row.mark}/${d.collection.totalMarks}${row.released ? " released" : ""}` : ""}
                      {row.attempts > 1 ? ` · ${row.attempts} attempts` : ""}
                      {row.draftStatus === "PENDING" ? " · drafting" : ""}
                      {row.draftStatus === "READY" && row.status === "SUBMITTED" ? " · AI draft ready" : ""}
                      {row.autoMark !== null && row.mark === null ? ` · automatic ${row.autoMark}/${d.collection.totalMarks}` : ""}
                      {row.fileCount > 0 ? ` · ${row.fileCount} file${row.fileCount === 1 ? "" : "s"}` : ""}
                    </Caption>
                  </Pressable>
                  {open === row.studentId ? (
                    <StudentWork
                      schoolId={schoolId}
                      userId={userId}
                      homeworkId={homeworkId}
                      row={row}
                      aiDrafting={d.aiDrafting}
                      onChanged={() => void queryClient.invalidateQueries({ queryKey: key })}
                    />
                  ) : null}
                </Card>
              ))}
              <GradebookCard data={d} schoolId={schoolId} userId={userId} />
              <SimilarityCard homeworkId={homeworkId} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, paddingVertical: spacing.md },
  row: { gap: spacing.xs, minHeight: 44, justifyContent: "center" },
  attempt: { gap: spacing.sm, paddingTop: spacing.sm },
  question: { gap: 2, paddingTop: spacing.xs },
  answer: { padding: spacing.sm, borderRadius: 8 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
