import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Redirect, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssessmentFeedRowDto, SubjectCommentRowDto } from "@school-kit/types";

import { staffTeacherScope } from "../../../../../src/lib/api/staff-attendance";
import { staffGradebookFeed } from "../../../../../src/lib/api/staff-gradebook";
import {
  staffAcceptSubjectComment,
  staffGenerateSubjectComments,
  staffListSubjectComments,
} from "../../../../../src/lib/api/staff-comments";
import { ApiError, ApiNetworkError } from "../../../../../src/lib/api/client";
import { queryKeys } from "../../../../../src/lib/query/keys";
import { useSession } from "../../../../../src/lib/auth/session";
import {
  clearDraftCells,
  commentDraftKey,
  getGradebookDraftsVersion,
  readDraft,
  setDraftCell,
  subscribeGradebookDrafts,
  type DraftScope,
} from "../../../../../src/lib/staff/gradebook-drafts";
import { useTheme } from "../../../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../../../src/theme/tokens";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../../../../src/components/ui";

// CP6b — report-card subject comments for one (arm × subject) in the current
// term.
//
// D23: THE APPROVAL GATE IS THIS SCREEN'S JOB TOO. The server enforces it —
// `generate` only ever produces a suggestion, and `accept` is the only writer
// of Assessment.subjectComment — but a screen that showed a draft as though it
// were already on the report card would defeat the gate just as thoroughly as
// skipping it. So: a suggestion sits in an editable box labelled "Draft — not
// on the report card", one Accept per student, and there is no "accept all".
//
// Unaccepted edits go through the D19 in-memory draft store, so the staff lock
// cannot silently discard a comment a teacher has been rewriting. Never disk.

// Matching web: slow enough not to hammer the API for a job that takes seconds
// per student, fast enough that comments visibly arrive.
const POLL_MS = 6000;
// ~5 minutes. Beyond this a missing suggestion is a failure the screen will
// never be told about directly (jobs fail on the worker), so say so instead of
// spinning for the rest of the afternoon.
const MAX_POLLS = 50;

const AI_UNAVAILABLE_CODES = [
  "AI_NOT_CONFIGURED",
  "AI_DISABLED_SCHOOL",
  "AI_DISABLED_PLATFORM",
  "AI_BUDGET_EXCEEDED",
];

function studentName(student: AssessmentFeedRowDto["student"]): string {
  return [student.firstName, student.lastName].filter(Boolean).join(" ");
}

function describeFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiNetworkError) {
    return "Your phone couldn't reach the server. Nothing was sent — try again when you have signal.";
  }
  if (error instanceof ApiError) {
    if (AI_UNAVAILABLE_CODES.includes(error.code)) {
      return "AI drafting isn't available for your school right now. You can still type comments yourself.";
    }
    if (error.code === "REPORT_CARD_RELEASED") {
      return "Report cards for this term have been released, so comments are locked. Ask your school administrator to reopen them.";
    }
    if (error.code === "SUBJECT_SIGNED_OFF") {
      return "This subject is signed off for that student, so the comment is frozen. Edit the marks to reopen it.";
    }
    if (error.status === 404) return "This class or subject is no longer assigned to you.";
    return error.message || fallback;
  }
  return fallback;
}

export default function SubjectCommentsScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { armId, subjectId } = useLocalSearchParams<{ armId: string; subjectId: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "" && !!armId && !!subjectId;

  const scope = useQuery({
    queryKey: queryKeys.staffScope(schoolId, userId),
    queryFn: staffTeacherScope,
    enabled: ready,
    staleTime: 60_000,
  });
  const term = scope.data?.currentTerm ?? null;
  const termId = term?.id ?? "";

  // The roster comes from the gradebook feed: SubjectCommentRowDto carries no
  // name or admission number on purpose, so the screen that renders it must
  // already hold the roster. Same query key as the mark sheet, so opening this
  // screen after entering marks costs nothing.
  const feed = useQuery({
    queryKey: queryKeys.staffGradebook(schoolId, userId, termId, armId ?? "", subjectId ?? ""),
    queryFn: () => staffGradebookFeed(termId, armId as string, subjectId as string),
    enabled: ready && termId !== "",
    staleTime: 60_000,
  });

  const [focused, setFocused] = useState(true);
  const [polls, setPolls] = useState(0);
  const [waitingFor, setWaitingFor] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Polling stops when the screen is not on top: no background traffic from a
  // screen a teacher left open in another tab of their day.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const commentsKey = queryKeys.staffSubjectComments(
    schoolId,
    userId,
    termId,
    armId ?? "",
    subjectId ?? "",
  );
  const comments = useQuery({
    queryKey: commentsKey,
    queryFn: () =>
      staffListSubjectComments({
        classArmId: armId as string,
        subjectId: subjectId as string,
        termId,
      }),
    enabled: ready && termId !== "",
    staleTime: 0,
    refetchInterval: waitingFor > 0 && focused ? POLL_MS : false,
  });

  const rows = useMemo(() => feed.data?.data ?? [], [feed.data]);
  const byStudent = useMemo(
    () => new Map((comments.data ?? []).map((row: SubjectCommentRowDto) => [row.studentId, row])),
    [comments.data],
  );

  const draftScope: DraftScope = {
    schoolId,
    userId,
    termId,
    classArmId: armId ?? "",
    subjectId: subjectId ?? "",
  };
  useSyncExternalStore(subscribeGradebookDrafts, getGradebookDraftsVersion, getGradebookDraftsVersion);
  const draftsKey = termId ? commentDraftKey(draftScope) : null;
  const drafts = draftsKey ? readDraft(draftsKey) : {};

  // Count arrivals against what was queued: the list endpoint is the only
  // progress signal — there is no job-status table to read.
  const arrived = (comments.data ?? []).filter((row) => row.suggestion !== null).length;
  const polled = comments.dataUpdatedAt;

  useEffect(() => {
    if (waitingFor > 0 && arrived >= waitingFor) {
      setWaitingFor(0);
      setPolls(0);
    }
  }, [arrived, waitingFor]);

  useEffect(() => {
    if (waitingFor === 0) return;
    setPolls((count) => count + 1);
  }, [polled, waitingFor]);

  // Give up at the cap rather than waiting on jobs nobody will ever tell us
  // failed: generation runs on the worker, and a failure there (a refusal, a
  // spent budget, a restart) never reaches this screen directly.
  useEffect(() => {
    if (waitingFor === 0 || polls < MAX_POLLS) return;
    setWaitingFor(0);
    setPolls(0);
    setNotice(
      "Some comments couldn't be drafted. Press Draft comments again to retry the ones still missing.",
    );
  }, [polls, waitingFor]);

  const generate = useMutation({
    mutationFn: () =>
      staffGenerateSubjectComments({
        classArmId: armId as string,
        subjectId: subjectId as string,
        termId,
      }),
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: (result) => {
      setPolls(0);
      setWaitingFor(result.queued);
      const skips: string[] = [];
      if (result.skippedSignedOff > 0) skips.push(`${result.skippedSignedOff} already signed off`);
      if (result.skippedNoScores > 0) skips.push(`${result.skippedNoScores} with no marks yet`);
      setNotice(
        result.queued === 0
          ? `Nothing to draft${skips.length ? ` — ${skips.join(", ")}.` : "."}`
          : `Drafting ${result.queued} comment${result.queued === 1 ? "" : "s"}${
              skips.length ? ` (skipped ${skips.join(", ")})` : ""
            }. They appear below as they finish.`,
      );
    },
    onError: (error: unknown) => {
      setWaitingFor(0);
      setFailure(describeFailure(error, "Could not start drafting comments."));
    },
  });

  const accept = useMutation({
    mutationFn: (input: { studentId: string; comment: string }) =>
      staffAcceptSubjectComment({
        studentId: input.studentId,
        subjectId: subjectId as string,
        termId,
        comment: input.comment,
      }),
    onMutate: (input) => {
      setSavingId(input.studentId);
      setFailure(null);
    },
    onSuccess: (updated, input) => {
      queryClient.setQueryData<SubjectCommentRowDto[]>(commentsKey, (previous) =>
        (previous ?? []).map((row) =>
          row.studentId === input.studentId ? { ...row, ...updated } : row,
        ),
      );
      if (draftsKey) clearDraftCells(draftsKey, [input.studentId]);
      setNotice("Saved to the report card.");
    },
    onError: (error: unknown) => {
      setFailure(describeFailure(error, "Could not save that comment."));
    },
    onSettled: () => setSavingId(null),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const arm = scope.data?.classArms.find((a) => a.id === armId) ?? null;
  const subject = (scope.data?.subjectsByArm[armId ?? ""] ?? []).find((s) => s.id === subjectId) ?? null;
  const header = (
    <Stack.Screen options={{ headerShown: true, title: "Comments" }} />
  );

  if (scope.data && (!arm || !subject)) {
    return (
      <Screen>
        {header}
        <Notice tone="info">This isn&apos;t one of your subjects.</Notice>
      </Screen>
    );
  }

  if (scope.data && !term) {
    return (
      <Screen>
        {header}
        <Notice tone="warning">
          No term is active. Ask your school administrator to set the current term.
        </Notice>
      </Screen>
    );
  }

  const loading = scope.isPending || feed.isPending || comments.isPending;
  const loadFailed = (feed.isError && !feed.data) || (comments.isError && !comments.data);

  if (loading || loadFailed) {
    return (
      <Screen>
        {header}
        <CenteredMessage>
          {loadFailed ? (
            <>
              <Notice tone="danger">We couldn&apos;t load these comments. Try again shortly.</Notice>
              <Button
                title="Try again"
                variant="secondary"
                onPress={() => {
                  void feed.refetch();
                  void comments.refetch();
                }}
              />
            </>
          ) : (
            <Body muted>Loading comments…</Body>
          )}
        </CenteredMessage>
      </Screen>
    );
  }

  const drafting = waitingFor > 0;

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Heading>Report card comments</Heading>
        <Body muted>
          {subject && arm ? `${subject.name} — ${arm.name}. ` : ""}
          Drafted from each student&apos;s marks. Nothing reaches a report card until you accept it.
        </Body>

        <View style={styles.actions}>
          <Button
            title={drafting ? "Drafting…" : "Draft comments with AI"}
            loading={generate.isPending || drafting}
            disabled={generate.isPending || drafting || rows.length === 0}
            onPress={() => generate.mutate()}
          />
        </View>

        {notice ? <Notice tone="info">{notice}</Notice> : null}
        {failure ? <Notice tone="danger">{failure}</Notice> : null}

        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          {rows.length === 0 && (
            <Notice tone="info">No students are enrolled in this class this term.</Notice>
          )}

          {rows.map((row) => {
            const studentId = row.student.id;
            const comment = byStudent.get(studentId);
            const signedOff = Boolean(comment?.signedOffAt);
            const accepted = comment?.comment ?? null;
            const suggestion = comment?.suggestion ?? null;
            const draft = drafts[studentId];
            const value = draft ?? accepted ?? suggestion ?? "";
            const edited = draft !== undefined && draft !== (accepted ?? "");
            const unaccepted = accepted === null && suggestion !== null;
            const saving = savingId === studentId;

            return (
              <Card key={studentId} style={styles.row}>
                <View style={styles.rowHead}>
                  <Body>{studentName(row.student)}</Body>
                  <Label>
                    {comment?.letterGrade ? comment.letterGrade + " · " : ""}
                    {comment?.totalScore === null || comment?.totalScore === undefined
                      ? "no total yet"
                      : String(comment.totalScore)}
                  </Label>
                </View>

                {signedOff ? (
                  <>
                    <Body muted>{accepted ?? "No comment was recorded before sign-off."}</Body>
                    <Label>Signed off — the comment is frozen.</Label>
                  </>
                ) : (
                  <>
                    <TextInput
                      value={value}
                      onChangeText={(text) => {
                        if (!draftsKey) return;
                        setFailure(null);
                        if (text === (accepted ?? "")) {
                          clearDraftCells(draftsKey, [studentId]);
                          return;
                        }
                        setDraftCell(draftsKey, studentId, text);
                      }}
                      multiline
                      maxLength={1000}
                      editable={!saving}
                      placeholder={
                        drafting
                          ? "Drafting…"
                          : "No draft yet — write one, or press Draft comments with AI."
                      }
                      placeholderTextColor={colors.mutedForeground}
                      accessibilityLabel={`Report card comment for ${studentName(row.student)}`}
                      style={[
                        styles.input,
                        {
                          color: colors.foreground,
                          backgroundColor: colors.card,
                          borderColor: edited || unaccepted ? colors.warning : colors.border,
                        },
                      ]}
                    />
                    <View style={styles.rowFoot}>
                      <Label>
                        {unaccepted || edited
                          ? "Draft — not on the report card"
                          : accepted
                            ? "On the report card"
                            : "Nothing saved yet"}
                      </Label>
                      <Button
                        title={saving ? "Saving" : "Accept"}
                        loading={saving}
                        disabled={
                          saving || value.trim().length === 0 || (!edited && !unaccepted)
                        }
                        onPress={() => accept.mutate({ studentId, comment: value.trim() })}
                      />
                    </View>
                  </>
                )}
              </Card>
            );
          })}
        </ScrollView>

        {Object.keys(drafts).length > 0 ? (
          <Body muted>
            Unaccepted comments stay if the app locks, but are lost if you close the app.
          </Body>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  actions: { paddingTop: spacing.sm },
  list: { gap: spacing.sm, paddingVertical: spacing.md },
  row: { gap: spacing.sm },
  rowHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  rowFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    textAlignVertical: "top",
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
});
