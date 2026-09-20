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
import type { FormCommentRowDto, TeacherRosterStudentDto } from "@school-kit/types";

import { staffArmRoster, staffTeacherScope } from "../../../src/lib/api/staff-attendance";
import {
  staffGenerateFormComments,
  staffListFormComments,
  staffSaveFormComment,
} from "../../../src/lib/api/staff-report-cards";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import {
  clearDraftCells,
  formCommentDraftKey,
  getGradebookDraftsVersion,
  readDraft,
  setDraftCell,
  subscribeGradebookDrafts,
} from "../../../src/lib/staff/gradebook-drafts";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import { EmptyState, ScreenHeader, Skeleton } from "../../../src/components/layout";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Label,
  Notice,
  Screen,
} from "../../../src/components/ui";

// CP7 (1) — the form teacher's overall comment: one per child, about their
// whole term, as opposed to CP6b's per-subject comments.
//
// Two differences from CP6b that matter, both from the server's own shape:
//
//   1. The WRITE is not on this surface. `POST /report-card-comments/form/
//      generate` only drafts; saving is `PATCH /report-cards/:id`, which owns
//      the auth, the workflow-status gate and the audit row. That is why each
//      row carries a reportCardId.
//   2. `editable` mirrors the workflow gate, so the screen refuses for the same
//      reason the API would — once a card moves past FORM_REVIEWED the comment
//      is frozen, and that is shown rather than discovered on save.
//
// The AI approval gate is presented exactly as in CP6b: a draft is visibly not
// on the report card until Save is pressed for that child, and there is no
// save-all.

const POLL_MS = 6000;
const MAX_POLLS = 50;

const AI_UNAVAILABLE_CODES = [
  "AI_NOT_CONFIGURED",
  "AI_DISABLED_SCHOOL",
  "AI_DISABLED_PLATFORM",
  "AI_BUDGET_EXCEEDED",
];

function fullName(student: TeacherRosterStudentDto | undefined): string {
  if (!student) return "This student";
  return [student.firstName, student.lastName].filter(Boolean).join(" ");
}

function describeFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiNetworkError) {
    return "Your phone couldn't reach the server. Nothing was sent — try again when you have signal.";
  }
  if (error instanceof ApiError) {
    if (AI_UNAVAILABLE_CODES.includes(error.code)) {
      return "AI drafting isn't available for your school right now. You can still write comments yourself.";
    }
    if (error.code === "REPORT_CARD_RELEASED") {
      return "These report cards have been released, so comments are locked. Ask your school administrator to reopen them.";
    }
    if (error.status === 404) {
      return "You are not the form teacher of this class, or the report cards haven't been built yet.";
    }
    return error.message || fallback;
  }
  return fallback;
}

export default function FormCommentsScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { armId } = useLocalSearchParams<{ armId: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "" && !!armId;

  const scope = useQuery({
    queryKey: queryKeys.staffScope(schoolId, userId),
    queryFn: staffTeacherScope,
    enabled: ready,
    staleTime: 60_000,
  });
  const term = scope.data?.currentTerm ?? null;
  const termId = term?.id ?? "";

  // Names come from the roster: FormCommentRowDto deliberately carries none.
  const roster = useQuery({
    queryKey: queryKeys.staffRoster(schoolId, userId, armId ?? ""),
    queryFn: () => staffArmRoster(armId as string),
    enabled: ready,
    staleTime: 60_000,
  });

  const [focused, setFocused] = useState(true);
  const [polls, setPolls] = useState(0);
  const [waitingFor, setWaitingFor] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const commentsKey = queryKeys.staffFormComments(schoolId, userId, termId, armId ?? "");
  const comments = useQuery({
    queryKey: commentsKey,
    queryFn: () => staffListFormComments({ classArmId: armId as string, termId }),
    enabled: ready && termId !== "",
    staleTime: 0,
    refetchInterval: waitingFor > 0 && focused ? POLL_MS : false,
  });

  useSyncExternalStore(
    subscribeGradebookDrafts,
    getGradebookDraftsVersion,
    getGradebookDraftsVersion,
  );
  const draftsKey = termId
    ? formCommentDraftKey({ schoolId, userId, termId, classArmId: armId ?? "" })
    : null;
  const drafts = draftsKey ? readDraft(draftsKey) : {};

  const rows = useMemo(() => comments.data ?? [], [comments.data]);
  const byStudent = useMemo(
    () => new Map((roster.data?.data ?? []).map((student) => [student.id, student])),
    [roster.data],
  );

  const arrived = rows.filter((row) => row.suggestion !== null).length;
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
      staffGenerateFormComments({ classArmId: armId as string, termId }),
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: (result) => {
      setPolls(0);
      setWaitingFor(result.queued);
      const skips: string[] = [];
      if (result.skippedLocked > 0) skips.push(`${result.skippedLocked} already locked`);
      if (result.skippedNoResults > 0) skips.push(`${result.skippedNoResults} with no results yet`);
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

  const save = useMutation({
    mutationFn: (input: { studentId: string; reportCardId: string; comment: string }) =>
      staffSaveFormComment(input.reportCardId, input.comment),
    onMutate: (input) => {
      setSavingId(input.studentId);
      setFailure(null);
    },
    onSuccess: (updated, input) => {
      // Re-read the row from the server's response rather than echoing what we
      // sent: PATCH is the authority on what landed on the card.
      queryClient.setQueryData<FormCommentRowDto[]>(commentsKey, (previous) =>
        (previous ?? []).map((row) =>
          row.studentId === input.studentId
            ? { ...row, comment: updated.formTeacherComment ?? null }
            : row,
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
  const isFormTeacher = (scope.data?.formTeacherArmIds ?? []).includes(armId ?? "");
  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (scope.data && !isFormTeacher) {
    return (
      <Screen>
        {header}
        <Notice tone="info">
          Only the form teacher writes the overall comment for a class. You can still write
          subject comments from the marks screen.
        </Notice>
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

  const loading = scope.isPending || comments.isPending || roster.isPending;
  const loadFailed = comments.isError && !comments.data;

  if (loading || loadFailed) {
    return (
      <Screen>
        {header}
        <CenteredMessage>
          {loadFailed ? (
            <>
              <Notice tone="danger">{describeFailure(comments.error, "We couldn't load these comments.")}</Notice>
              <Button title="Try again" variant="secondary" onPress={() => void comments.refetch()} />
            </>
          ) : (
            <Skeleton lines={4} />
          )}
        </CenteredMessage>
      </Screen>
    );
  }

  const locked = rows.length > 0 && rows.every((row) => !row.editable);
  const drafting = waitingFor > 0;

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScreenHeader
          title="Report card comments"
          subtitle={`${
            arm ? arm.name + " · " : ""
          }Nothing reaches a report card until you save it.`}
        />

        {rows.length === 0 ? (
          <EmptyState
            icon="document-outline"
            title="No report cards yet"
            body="An administrator builds them once subject marks are in. Your comments can be written after that."
          />
        ) : locked ? (
          <Notice tone="warning">
            These report cards have moved past the form teacher stage, so the comments are frozen.
          </Notice>
        ) : null}

        {rows.length > 0 && !locked && (
          <View style={styles.actions}>
            <Button
              title={drafting ? "Drafting…" : "Draft comments with AI"}
              loading={generate.isPending || drafting}
              disabled={generate.isPending || drafting}
              onPress={() => generate.mutate()}
            />
          </View>
        )}

        {notice ? <Notice tone="info">{notice}</Notice> : null}
        {failure ? <Notice tone="danger">{failure}</Notice> : null}

        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          {rows.map((row) => {
            const student = byStudent.get(row.studentId);
            const accepted = row.comment ?? null;
            const suggestion = row.suggestion ?? null;
            const draft = drafts[row.studentId];
            const value = draft ?? accepted ?? suggestion ?? "";
            const edited = draft !== undefined && draft !== (accepted ?? "");
            const unsaved = accepted === null && suggestion !== null;
            const saving = savingId === row.studentId;

            return (
              <Card key={row.studentId} style={styles.row}>
                <View style={styles.rowHead}>
                  <Body>{fullName(student)}</Body>
                  <Label>
                    {row.overallAverage === null ? "no average yet" : `${row.overallAverage}%`}
                    {row.overallPosition === null ? "" : ` · position ${row.overallPosition}`}
                  </Label>
                </View>

                {row.editable ? (
                  <>
                    <TextInput
                      value={value}
                      onChangeText={(text) => {
                        if (!draftsKey) return;
                        setFailure(null);
                        if (text === (accepted ?? "")) {
                          clearDraftCells(draftsKey, [row.studentId]);
                          return;
                        }
                        setDraftCell(draftsKey, row.studentId, text);
                      }}
                      multiline
                      maxLength={2000}
                      editable={!saving}
                      placeholder={
                        drafting
                          ? "Drafting…"
                          : "No draft yet — write one, or press Draft comments with AI."
                      }
                      placeholderTextColor={colors.mutedForeground}
                      accessibilityLabel={`Overall comment for ${fullName(student)}`}
                      style={[
                        styles.input,
                        {
                          color: colors.foreground,
                          backgroundColor: colors.card,
                          borderColor: edited || unsaved ? colors.warning : colors.border,
                        },
                      ]}
                    />
                    <View style={styles.rowFoot}>
                      <Label>
                        {unsaved || edited
                          ? "Draft — not on the report card"
                          : accepted
                            ? "On the report card"
                            : "Nothing saved yet"}
                      </Label>
                      <Button
                        title={saving ? "Saving" : "Save"}
                        loading={saving}
                        disabled={saving || value.trim().length === 0 || (!edited && !unsaved)}
                        onPress={() =>
                          save.mutate({
                            studentId: row.studentId,
                            reportCardId: row.reportCardId,
                            comment: value.trim(),
                          })
                        }
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <Body muted>{accepted ?? "No comment was written before this card locked."}</Body>
                    <Label>Locked — this card has moved past the form teacher stage.</Label>
                  </>
                )}
              </Card>
            );
          })}
        </ScrollView>

        {Object.keys(drafts).length > 0 ? (
          <Body muted>
            Unsaved comments stay if the app locks, but are lost if you close the app.
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
  rowHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    textAlignVertical: "top",
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
});
