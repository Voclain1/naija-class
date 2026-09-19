import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssessmentFeedRowDto, GradingComponentDto } from "@school-kit/types";

import { staffTeacherScope } from "../../../../../src/lib/api/staff-attendance";
import {
  staffGradebookFeed,
  staffGradingScheme,
  staffSaveScores,
  staffSignOffColumn,
} from "../../../../../src/lib/api/staff-gradebook";
import { ApiError, ApiNetworkError } from "../../../../../src/lib/api/client";
import { queryKeys } from "../../../../../src/lib/query/keys";
import { useSession } from "../../../../../src/lib/auth/session";
import {
  clearDraft,
  clearDraftCells,
  componentsWithDrafts,
  hasCommentDrafts,
  draftKey,
  getGradebookDraftsVersion,
  readDraft,
  setDraftCell,
  subscribeGradebookDrafts,
  type DraftScope,
} from "../../../../../src/lib/staff/gradebook-drafts";
import {
  collectComponentSave,
  columnSignedOffAt,
  componentProgress,
  isColumnFullyScored,
  issuesByStudent,
  savedScore,
  signOffBlockReason,
} from "../../../../../src/lib/staff/gradebook-rules";
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

// CP6a — the mark sheet for one (arm × subject) in the current term.
//
// The rules this screen carries, each from the approved plan-first
// (docs/modules/staff-mobile-companion.md, CP6):
//
//   D18  ONE COMPONENT AT A TIME. A teacher holds a pile of scripts for one
//        test, so the sheet is "1st CA /20" down the class list, not a grid.
//
//   D19  UNSAVED MARKS LIVE IN THE IN-MEMORY DRAFT STORE, not component state.
//        The two-minute staff lock unmounts this screen; the store survives
//        that, is never written to disk, and is wiped at sign-out.
//
//   D20  A SIGNED-OFF COLUMN OPENS READ-ONLY. The server silently clears
//        sign-off on any edit, so unlocking the inputs asks first.
//
//   D21  A SAVED MARK CANNOT BE EMPTIED — the bulk upsert has no delete, so
//        the phone refuses rather than pretending to clear it.
//
//   D22  NO POSITIONS. They are recomputed separately on web and may be stale
//        after any save.
//
// And CP2's write rules: dirty cells only, one atomic call, no optimistic
// write, no queue, no retry. Totals and grades are the server's.

type Banner = { tone: "info" | "warning" | "danger"; text: string } | null;

function studentName(student: AssessmentFeedRowDto["student"]): string {
  return [student.firstName, student.lastName].filter(Boolean).join(" ");
}

function formatDate(stamp: string | Date): string {
  const date = new Date(stamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function describeSaveFailure(error: unknown): string {
  if (error instanceof ApiNetworkError) {
    return "Not saved. Your phone couldn't reach the server. Your marks are still here — try again when you have signal.";
  }
  if (error instanceof ApiError) {
    if (error.code === "REPORT_CARD_RELEASED") {
      return "Not saved. Report cards for this term have been released, so these marks are locked. Ask your school administrator to reopen them.";
    }
    if (error.status === 404) {
      return "Not saved. This class or subject is no longer assigned to you.";
    }
    return "Not saved. " + error.message;
  }
  return "Not saved. Please try again.";
}

export default function MarkSheetScreen() {
  const { colors } = useTheme();
  const router = useRouter();
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
  const scheme = useQuery({
    queryKey: queryKeys.staffGradingScheme(schoolId, userId),
    queryFn: staffGradingScheme,
    enabled: ready,
    staleTime: 5 * 60_000,
  });

  const term = scope.data?.currentTerm ?? null;
  const termId = term?.id ?? "";
  const feedKey = queryKeys.staffGradebook(schoolId, userId, termId, armId ?? "", subjectId ?? "");
  const feed = useQuery({
    queryKey: feedKey,
    queryFn: () => staffGradebookFeed(termId, armId as string, subjectId as string),
    enabled: ready && termId !== "",
    staleTime: 0,
  });

  const components = useMemo<GradingComponentDto[]>(
    () => [...(scheme.data?.components ?? [])].sort((a, b) => a.orderIndex - b.orderIndex),
    [scheme.data],
  );
  const rows = useMemo(() => feed.data?.data ?? [], [feed.data]);

  const draftScope: DraftScope = {
    schoolId,
    userId,
    termId,
    classArmId: armId ?? "",
    subjectId: subjectId ?? "",
  };

  // Subscribing to the version keeps every draft-derived value below current.
  useSyncExternalStore(subscribeGradebookDrafts, getGradebookDraftsVersion, getGradebookDraftsVersion);
  const componentsWithUnsaved = termId ? componentsWithDrafts(draftScope) : [];

  const [chosenComponentId, setChosenComponentId] = useState<string | null>(null);
  // Resume where the unsaved marks are, so a teacher returning after the lock
  // lands on the test they were entering rather than the first one.
  const componentId =
    chosenComponentId ??
    components.find((c) => componentsWithUnsaved.includes(c.id))?.id ??
    components[0]?.id ??
    null;
  const component = components.find((c) => c.id === componentId) ?? null;

  const key = component && termId ? draftKey(draftScope, component.id) : null;
  const draft = key ? readDraft(key) : {};

  const [editingSignedOff, setEditingSignedOff] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<Banner>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const inputs = useRef<Record<string, TextInput | null>>({});

  const signedOffAt = feed.data ? columnSignedOffAt(feed.data) : null;
  // Unsaved marks on a signed-off column can only exist because the teacher
  // already confirmed D20 before the lock unmounted the screen.
  const locked = signedOffAt !== null && !editingSignedOff && componentsWithUnsaved.length === 0;

  const pending = component
    ? collectComponentSave(rows, component, draft)
    : { rows: [], dirtyStudentIds: [], errors: {} as Record<string, string> };

  const save = useMutation({
    mutationFn: (sent: { studentId: string; componentId: string; score: number }[]) =>
      staffSaveScores({ termId, subjectId: subjectId as string, rows: sent }),
    onSuccess: (refreshed) => {
      // The server's column replaces ours: totals, grades and the cleared
      // sign-off all come from this response, never from local arithmetic.
      queryClient.setQueryData(feedKey, refreshed);
      if (key) clearDraft(key);
      setServerErrors({});
      setEditingSignedOff(false);
      setBanner({ tone: "info", text: "Saved." });
    },
    onError: (error: unknown, sent) => {
      if (error instanceof ApiError && error.status === 400) {
        const bound = issuesByStudent(error.details, sent);
        setServerErrors(bound);
        const count = Object.keys(bound).length;
        setBanner({
          tone: "danger",
          text:
            count > 0
              ? `Not saved. ${count} mark${count === 1 ? "" : "s"} need fixing.`
              : describeSaveFailure(error),
        });
        return;
      }
      setBanner({ tone: "danger", text: describeSaveFailure(error) });
    },
  });

  const signOff = useMutation({
    mutationFn: () =>
      staffSignOffColumn({
        termId,
        subjectId: subjectId as string,
        classArmId: armId as string,
      }),
    onSuccess: async () => {
      setBanner({ tone: "info", text: "Signed off." });
      await queryClient.invalidateQueries({ queryKey: feedKey });
    },
    onError: (error: unknown) => {
      setBanner({
        tone: "danger",
        text:
          error instanceof ApiError && error.status === 400
            ? "Not signed off. Some students are still missing marks."
            : describeSaveFailure(error).replace("Not saved.", "Not signed off."),
      });
    },
  });

  const busy = save.isPending || signOff.isPending;

  const onChangeCell = useCallback(
    (studentId: string, value: string, saved: number | null) => {
      if (!key) return;
      setBanner(null);
      setServerErrors((prev) => {
        if (!(studentId in prev)) return prev;
        const next = { ...prev };
        delete next[studentId];
        return next;
      });
      const digits = value.replace(/[^0-9]/g, "");
      // A cell typed back to what is already saved (or left blank when nothing
      // is saved) is not a draft. Keeping it would hold sign-off back and warn
      // about "unsaved marks" that are not.
      if (digits === (saved === null ? "" : String(saved))) {
        clearDraftCells(key, [studentId]);
        return;
      }
      setDraftCell(key, studentId, digits);
    },
    [key],
  );

  const onSave = () => {
    const errorCount = Object.keys(pending.errors).length;
    if (errorCount > 0) {
      setBanner({
        tone: "danger",
        text: `Fix ${errorCount} mark${errorCount === 1 ? "" : "s"} before saving.`,
      });
      return;
    }
    if (pending.rows.length === 0) return;
    save.mutate(pending.rows);
  };

  const confirmEdit = () => {
    Alert.alert(
      "Edit signed-off marks?",
      "Changing a mark will undo your sign-off for this subject. You'll need to sign off again.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Edit marks", style: "destructive", onPress: () => setEditingSignedOff(true) },
      ],
    );
  };

  const confirmSignOff = (title: string) => {
    Alert.alert(
      "Sign off " + title + "?",
      "This tells your school these marks are final, and it also freezes the report card comments for this subject. Write your comments first. You can still edit marks later, but that undoes the sign-off.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign off", onPress: () => signOff.mutate() },
      ],
    );
  };

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const arm = scope.data?.classArms.find((a) => a.id === armId) ?? null;
  const subject = (scope.data?.subjectsByArm[armId ?? ""] ?? []).find((s) => s.id === subjectId) ?? null;
  const title = subject && arm ? `${subject.name} — ${arm.name}` : "Enter marks";

  const outOfScope =
    (scope.data !== undefined && (!arm || !subject)) ||
    (feed.error instanceof ApiError && feed.error.status === 404);
  const loading = scope.isPending || scheme.isPending || (termId !== "" && feed.isPending);
  const loadFailed = (scope.isError && !scope.data) || (scheme.isError && !scheme.data) || (feed.isError && !feed.data);

  const fullyScored = feed.data ? isColumnFullyScored(feed.data, components) : false;
  const hasUnsaved = componentsWithUnsaved.length > 0;
  const signOffReason = signOffBlockReason({
    hasUnsavedMarks: hasUnsaved,
    // CP6b: sign-off freezes the comment too, so an unaccepted draft must not
    // be silently frozen out of existence.
    hasUnsavedComments: termId !== "" && hasCommentDrafts(draftScope),
    fullyScored,
  });

  const header = <Stack.Screen options={{ headerShown: true, title: subject?.name ?? "Enter marks" }} />;

  if (outOfScope) {
    return (
      <Screen>
        {header}
        <Notice tone="info">
          This isn&apos;t one of your subjects. You can only enter marks for the subjects you&apos;re
          assigned to teach.
        </Notice>
      </Screen>
    );
  }

  if (scope.data && !term) {
    return (
      <Screen>
        {header}
        <Notice tone="warning">
          No term is active. Ask your school administrator to set the current term before entering
          marks.
        </Notice>
      </Screen>
    );
  }

  if (loading || loadFailed || !feed.data || !scheme.data) {
    return (
      <Screen>
        {header}
        <CenteredMessage>
          {loadFailed ? (
            <>
              <Notice tone="danger">We couldn&apos;t load these marks. Try again shortly.</Notice>
              <Button
                title="Try again"
                variant="secondary"
                onPress={() => {
                  void scope.refetch();
                  void scheme.refetch();
                  void feed.refetch();
                }}
              />
            </>
          ) : (
            <Body muted>Loading marks…</Body>
          )}
        </CenteredMessage>
      </Screen>
    );
  }

  if (components.length === 0) {
    return (
      <Screen>
        {header}
        <Notice tone="danger">
          Your school hasn&apos;t set up its marking scheme yet. Ask your school administrator to set
          it up on the website under Settings → Grading.
        </Notice>
      </Screen>
    );
  }

  if (rows.length === 0) {
    return (
      <Screen>
        {header}
        <Heading>{title}</Heading>
        <Notice tone="info">No students are enrolled in this class for {term?.name ?? "this term"}.</Notice>
      </Screen>
    );
  }

  const dirtyCount = pending.dirtyStudentIds.length;

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Heading>{title}</Heading>
        <Body muted>{term?.name ?? ""}</Body>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipRow}
        >
          {components.map((c) => {
            const active = c.id === componentId;
            const progress = componentProgress(feed.data, c.id);
            const unsaved = componentsWithUnsaved.includes(c.id);
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${c.label}, out of ${c.weight}, ${progress.scored} of ${progress.total} entered${unsaved ? ", unsaved marks" : ""}`}
                onPress={() => {
                  setChosenComponentId(c.id);
                  setServerErrors({});
                  setBanner(null);
                  setExpanded(null);
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
                  style={[styles.chipTitle, { color: active ? colors.primaryForeground : colors.primary }]}
                >
                  {c.label} /{c.weight}
                  {unsaved ? " •" : ""}
                </Text>
                <Text
                  style={[
                    styles.chipMeta,
                    { color: active ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {progress.scored}/{progress.total} entered
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {signedOffAt !== null && locked && (
          <Card style={styles.signedOff}>
            <Body>Signed off {formatDate(signedOffAt)}. These marks are locked.</Body>
            <Button title="Edit marks" variant="secondary" onPress={confirmEdit} />
          </Card>
        )}
        {signedOffAt !== null && !locked && (
          <Notice tone="warning">
            Saving a change will undo your sign-off. You&apos;ll need to sign off again.
          </Notice>
        )}

        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          {rows.map((row, index) => {
            const studentId = row.student.id;
            const saved = component ? savedScore(row, component.id) : null;
            const draftValue = draft[studentId];
            const value = draftValue ?? (saved === null ? "" : String(saved));
            const error = serverErrors[studentId] ?? (draftValue !== undefined ? pending.errors[studentId] : undefined);
            const isDirty = pending.dirtyStudentIds.includes(studentId);
            const next = rows[index + 1]?.student.id;
            const open = expanded === studentId;

            return (
              <Card key={studentId} style={styles.row}>
                <View style={styles.rowMain}>
                  <Pressable
                    style={styles.rowText}
                    accessibilityRole="button"
                    accessibilityLabel={`${studentName(row.student)}, show all marks`}
                    onPress={() => setExpanded(open ? null : studentId)}
                  >
                    <Body>{studentName(row.student)}</Body>
                    <Label>
                      {row.student.admissionNumber}
                      {isDirty ? " · unsaved" : ""}
                    </Label>
                  </Pressable>
                  <View style={styles.cell}>
                    <TextInput
                      ref={(input) => {
                        inputs.current[studentId] = input;
                      }}
                      value={value}
                      onChangeText={(text) => onChangeCell(studentId, text, saved)}
                      editable={!locked && !busy}
                      keyboardType="number-pad"
                      returnKeyType={next ? "next" : "done"}
                      blurOnSubmit={!next}
                      onSubmitEditing={() => {
                        if (next) inputs.current[next]?.focus();
                      }}
                      maxLength={3}
                      selectTextOnFocus
                      accessibilityLabel={`${component?.label ?? "Mark"} for ${studentName(row.student)}, out of ${component?.weight ?? ""}`}
                      style={[
                        styles.input,
                        {
                          color: colors.foreground,
                          backgroundColor: colors.card,
                          borderColor: error ? colors.danger : isDirty ? colors.primary : colors.border,
                          opacity: locked ? 0.6 : 1,
                        },
                      ]}
                    />
                    <Text style={[styles.weight, { color: colors.mutedForeground }]}>
                      /{component?.weight ?? ""}
                    </Text>
                  </View>
                </View>
                {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
                {open && (
                  <View style={styles.summary}>
                    {components.map((c) => {
                      const score = savedScore(row, c.id);
                      return (
                        <Label key={c.id}>
                          {c.label}: {score === null ? "not entered" : `${score}/${c.weight}`}
                        </Label>
                      );
                    })}
                    <Label>
                      Total: {row.assessment ? row.assessment.totalScore : "—"}
                      {row.assessment?.letterGrade ? ` · Grade ${row.assessment.letterGrade}` : ""}
                    </Label>
                    <Label>Totals and grades update when marks are saved.</Label>
                  </View>
                )}
              </Card>
            );
          })}
        </ScrollView>

        {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}
        {hasUnsaved && (
          <Body muted>
            {dirtyCount > 0
              ? `${dirtyCount} unsaved mark${dirtyCount === 1 ? "" : "s"} in ${component?.label ?? "this test"}. `
              : "Unsaved marks in another test. "}
            They stay if the app locks, but are lost if you close the app.
          </Body>
        )}

        <View style={styles.actions}>
          {/* CP6b. Below the marks deliberately, like web: a comment
              interprets the marks above it. */}
          <Button
            title="Report card comments"
            variant="secondary"
            disabled={busy}
            onPress={() => router.push(`/staff/gradebook/${armId}/${subjectId}/comments`)}
          />
          <Button
            title={dirtyCount > 0 ? `Save ${dirtyCount} mark${dirtyCount === 1 ? "" : "s"}` : "Save marks"}
            loading={save.isPending}
            disabled={locked || busy || dirtyCount === 0}
            onPress={onSave}
          />
          {signedOffAt === null && (
            <>
              <Button
                title="Sign off subject"
                variant="secondary"
                loading={signOff.isPending}
                disabled={busy || signOffReason !== null}
                onPress={() => confirmSignOff(title)}
              />
              {signOffReason ? <Label>{signOffReason}</Label> : null}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  chipRow: { flexGrow: 0, marginTop: spacing.sm },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    justifyContent: "center",
  },
  chipTitle: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  chipMeta: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
  signedOff: { gap: spacing.sm, marginTop: spacing.sm },
  list: { gap: spacing.sm, paddingVertical: spacing.md },
  row: { gap: spacing.xs },
  rowMain: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowText: { flex: 1, gap: spacing.xs },
  cell: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  input: {
    width: 64,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    textAlign: "center",
    fontFamily: fonts.sansSemibold,
    fontSize: fontSizes.bodyLarge,
  },
  weight: { fontFamily: fonts.sans, fontSize: fontSizes.body, minWidth: 28 },
  error: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
  summary: { gap: spacing.xs, paddingTop: spacing.xs },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
});
