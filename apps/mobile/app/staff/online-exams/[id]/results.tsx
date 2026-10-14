import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CbtResultRowDto, CbtResultsDto, ScorePreviewRowDto } from "@school-kit/types";

import { LoadError } from "../../../../src/components/load-error";
import {
  staffCbtPreviewGradebook,
  staffCbtResults,
  staffCbtSaveToGradebook,
  staffChooseCbtAttempt,
  staffSaveCbtTheoryMarks,
} from "../../../../src/lib/api/staff-cbt";
import { staffGradingScheme } from "../../../../src/lib/api/staff-gradebook";
import { ApiError, ApiNetworkError } from "../../../../src/lib/api/client";
import { queryKeys } from "../../../../src/lib/query/keys";
import { useSession } from "../../../../src/lib/auth/session";
import { hasPermission } from "../../../../src/lib/auth/permissions";
import {
  cbtFlagLabel,
  cbtNotReadyReason,
  changedTheoryRows,
  parseTheoryMark,
  plural,
  savedTheoryText,
} from "../../../../src/lib/staff/cbt-format";
import { useTheme } from "../../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../../src/theme/tokens";
import { Body, Button, Caption, Card, Heading, Label, Notice, Screen } from "../../../../src/components/ui";
import { ScreenHeader, SectionHeader, Skeleton } from "../../../../src/components/layout";
import { ChoiceChips } from "../../../../src/components/form";

// Online exam results (docs/modules/cbt.md D5, D6, D8) — the website's
// /teacher/cbt/[id]/results, with its table turned into one card per student
// so nothing runs off a phone screen.
//
// The multiple-choice score is marked on the server against the frozen paper;
// the teacher types the theory mark from the paper scripts, chooses which
// computer counts for a student who used two, and sends the totals to the
// gradebook through the same preview-then-save as the gradebook's own "Out of"
// (CP5a). Nothing reaches the gradebook unless the teacher saves it here.
//
// Typed theory marks are kept as EDITS over the saved marks: choosing a
// computer for one student, or pulling to refresh, never throws away marks
// typed for the class and not saved yet.

function describeFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiNetworkError) return "Your phone couldn't reach the server. Nothing changed. Try again when you have signal.";
  if (error instanceof ApiError) return error.message || fallback;
  return fallback;
}

export default function OnlineExamResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const permissions = staff?.permissions ?? [];
  const canRead = hasPermission(permissions, "cbt.read");
  const canManage = hasPermission(permissions, "cbt.manage");
  const sittingId = typeof id === "string" ? id : "";
  const ready = authed && canRead && schoolId !== "" && userId !== "" && sittingId !== "";

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [componentId, setComponentId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScorePreviewRowDto[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const resultsKey = queryKeys.staffCbtResults(schoolId, userId, sittingId);
  const results = useQuery({
    queryKey: resultsKey,
    queryFn: () => staffCbtResults(sittingId),
    enabled: ready,
    staleTime: 0,
  });
  const scheme = useQuery({
    queryKey: queryKeys.staffGradingScheme(schoolId, userId),
    queryFn: staffGradingScheme,
    enabled: ready && canManage,
    staleTime: 5 * 60_000,
  });
  const components = useMemo(
    () => [...(scheme.data?.components ?? [])].sort((a, b) => a.orderIndex - b.orderIndex),
    [scheme.data],
  );

  // The paper's own column by default; the teacher can pick another.
  useEffect(() => {
    if (componentId === null && results.data?.componentId) setComponentId(results.data.componentId);
  }, [results.data, componentId]);

  // A preview describes the results it was made from; any new results, or a
  // different column, make it stale.
  useEffect(() => {
    setPreview(null);
  }, [results.data, componentId]);

  const adopt = (r: CbtResultsDto) => queryClient.setQueryData(resultsKey, r);

  const saveTheory = useMutation({
    mutationFn: (input: { marks: { studentId: string; theoryMark: number | null }[] }) => staffSaveCbtTheoryMarks(sittingId, input),
    onMutate: () => {
      setNotice(null);
      setFailure(null);
    },
    onSuccess: (r, input) => {
      adopt(r);
      setEdits({});
      setNotice(`Saved ${plural(input.marks.length, "theory mark")}.`);
    },
    onError: (error) => setFailure(describeFailure(error, "Could not save the theory marks.")),
  });

  const choose = useMutation({
    mutationFn: (attemptId: string) => staffChooseCbtAttempt(sittingId, attemptId),
    onMutate: () => {
      setNotice(null);
      setFailure(null);
    },
    onSuccess: (r) => adopt(r),
    onError: (error) => setFailure(describeFailure(error, "Could not choose that attempt.")),
  });

  const gradebookRows = (r: CbtResultsDto, column: string) =>
    r.rows
      .filter((row) => row.total !== null)
      .map((row) => ({ studentId: row.studentId, componentId: column, raw: { mark: row.total!, outOf: r.paperTotal } }));

  const runPreview = useMutation({
    mutationFn: ({ r, column }: { r: CbtResultsDto; column: string }) =>
      staffCbtPreviewGradebook({ termId: r.termId, subjectId: r.subjectId, rows: gradebookRows(r, column) }),
    onMutate: () => {
      setNotice(null);
      setFailure(null);
    },
    onSuccess: (res) => setPreview(res.rows),
    onError: (error) => setFailure(describeFailure(error, "Could not preview the gradebook marks.")),
  });

  const send = useMutation({
    // The same rows the preview showed; the server scales them again.
    mutationFn: ({ r, column }: { r: CbtResultsDto; column: string }) =>
      staffCbtSaveToGradebook({ termId: r.termId, subjectId: r.subjectId, rows: gradebookRows(r, column) }),
    onMutate: () => {
      setNotice(null);
      setFailure(null);
    },
    onSuccess: async (_res, { r }) => {
      const count = r.rows.filter((row) => row.total !== null).length;
      setPreview(null);
      setNotice(`Saved ${plural(count, "mark")} to the gradebook.`);
      await queryClient.invalidateQueries({ queryKey: ["staff", schoolId, userId, "gradebook"] });
    },
    onError: (error) => setFailure(describeFailure(error, "Could not save to the gradebook.")),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (!canRead) {
    return (
      <Screen>
        {header}
        <ScreenHeader title="Results" />
        <Notice tone="info">Online exams are for teachers and administrators.</Notice>
      </Screen>
    );
  }

  if (results.isPending) {
    return (
      <Screen>
        {header}
        <Skeleton lines={6} />
      </Screen>
    );
  }

  if (results.isError || !results.data) {
    return (
      <Screen>
        {header}
        <ScreenHeader title="Results" />
        <LoadError error={results.error} what="the results" onRetry={() => void results.refetch()} />
      </Screen>
    );
  }

  const r = results.data;
  const hasTheory = r.onPaperTotal > 0;
  const changed = changedTheoryRows(r.rows, edits);
  const invalid = r.rows.filter((row) => parseTheoryMark(edits[row.studentId] ?? savedTheoryText(row), r.onPaperTotal) === "invalid");
  const readyRows = r.rows.filter((row) => row.total !== null);
  const names = new Map(r.rows.map((row) => [row.studentId, `${row.lastName}, ${row.firstName}`]));
  const component = components.find((c) => c.id === componentId);
  const busy = saveTheory.isPending || choose.isPending || runPreview.isPending || send.isPending;

  function onSaveTheory(): void {
    saveTheory.mutate({
      marks: changed.map((row) => ({
        studentId: row.studentId,
        theoryMark: parseTheoryMark(edits[row.studentId] ?? "", r.onPaperTotal) as number | null,
      })),
    });
  }

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={results.isRefetching} onRefresh={() => void results.refetch()} tintColor={colors.primary} />}
        >
          <ScreenHeader
            title="Results"
            subtitle={`${r.title}. Multiple choice: ${r.questionCount} questions, ${r.objectiveTotal} marks, marked automatically.${
              hasTheory ? ` Theory on paper: ${r.onPaperTotal} marks, typed in below.` : ""
            } Paper total: ${r.paperTotal}.`}
          />
          {r.status === "PUBLISHED" ? (
            <Notice tone="warning">
              This exam is still open. Answers from computers that have not sent yet will change these results; close the exam
              when every computer has sent.
            </Notice>
          ) : null}

          {notice ? <Notice tone="info">{notice}</Notice> : null}
          {failure ? <Notice tone="danger">{failure}</Notice> : null}

          <SectionHeader title="Students" note={String(r.rows.length)} />
          {r.rows.length === 0 ? <Body muted>No students.</Body> : null}
          {r.rows.map((row) => (
            <ResultCard
              key={row.studentId}
              row={row}
              results={r}
              typed={edits[row.studentId] ?? savedTheoryText(row)}
              onType={(v) => setEdits((e) => ({ ...e, [row.studentId]: v }))}
              canManage={canManage}
              choosing={choose.isPending ? (choose.variables ?? null) : null}
              disabled={busy}
              onChoose={(attemptId) => choose.mutate(attemptId)}
            />
          ))}

          {hasTheory && canManage ? (
            <>
              {invalid.length > 0 ? (
                <Notice tone="danger">Theory marks are whole numbers from 0 to {r.onPaperTotal}.</Notice>
              ) : null}
              <Button
                title={`Save theory marks${changed.length ? ` (${changed.length})` : ""}`}
                loading={saveTheory.isPending}
                disabled={changed.length === 0 || invalid.length > 0 || busy}
                onPress={onSaveTheory}
              />
            </>
          ) : null}

          {canManage ? (
            <Card style={styles.card}>
              <Heading>Send to the gradebook</Heading>
              <Body muted>
                Each total is saved as a mark out of {r.paperTotal} and scaled to the column, exactly as the gradebook&apos;s
                &ldquo;Out of&rdquo; does. You see every mark before anything is saved.
              </Body>
              {scheme.isPending ? (
                <Skeleton lines={1} />
              ) : scheme.isError ? (
                <LoadError error={scheme.error} what="the gradebook columns" onRetry={() => void scheme.refetch()} />
              ) : components.length === 0 ? (
                <Notice tone="info">The school has no gradebook columns set up yet.</Notice>
              ) : (
                <ChoiceChips
                  label="Gradebook column"
                  options={components.map((c) => ({ value: c.id, label: `${c.label} (${c.weight})` }))}
                  value={componentId}
                  onChange={setComponentId}
                />
              )}
              <Body>
                {readyRows.length} of {r.rows.length} students ready.
                {readyRows.length < r.rows.length ? " The others are listed above with what is missing; they are not sent." : ""}
              </Body>
              {changed.length > 0 ? <Notice tone="warning">Save the theory marks first.</Notice> : null}
              {preview === null ? (
                <Button
                  title="Preview gradebook marks"
                  variant="secondary"
                  loading={runPreview.isPending}
                  disabled={!componentId || readyRows.length === 0 || changed.length > 0 || busy}
                  onPress={() => componentId && runPreview.mutate({ r, column: componentId })}
                />
              ) : (
                <View style={[styles.preview, { backgroundColor: colors.background }]}>
                  <Body>
                    {component ? `${component.label}, out of ${component.weight}` : "Gradebook"} — {plural(preview.length, "mark")}
                  </Body>
                  {preview.map((p) => (
                    <Text key={p.studentId} style={[styles.previewLine, { color: colors.foreground }]}>
                      {names.get(p.studentId)}: {p.raw?.mark}/{p.raw?.outOf} → <Text style={styles.bold}>{p.score}</Text>
                    </Text>
                  ))}
                  <Caption>Saving replaces any marks already in this column for these students.</Caption>
                  <Button
                    title="Save to gradebook"
                    loading={send.isPending}
                    disabled={busy || changed.length > 0 || !componentId}
                    onPress={() => componentId && send.mutate({ r, column: componentId })}
                  />
                  <Button title="Back" variant="secondary" disabled={send.isPending} onPress={() => setPreview(null)} />
                </View>
              )}
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function ResultCard({
  row,
  results,
  typed,
  onType,
  canManage,
  choosing,
  disabled,
  onChoose,
}: {
  row: CbtResultRowDto;
  results: CbtResultsDto;
  typed: string;
  onType: (v: string) => void;
  canManage: boolean;
  choosing: string | null;
  disabled: boolean;
  onChoose: (attemptId: string) => void;
}) {
  const { colors } = useTheme();
  const notReady = cbtNotReadyReason(row);
  const many = row.attempts.length > 1;
  const badMark = parseTheoryMark(typed, results.onPaperTotal) === "invalid";
  const name = `${row.firstName} ${row.lastName}`;

  return (
    // A student who needs a choice gets a tinted card AND the words saying so
    // (no accent borders — CLAUDE.md).
    <Card style={[styles.card, row.needsChoice ? { backgroundColor: colors.warning + "1F" } : null]}>
      <Body>
        {row.lastName}, {row.firstName}
      </Body>
      <Caption>
        {row.admissionNumber} · {row.armName} · Version {row.version}
      </Caption>

      <Label>Online attempt</Label>
      {row.attempts.length === 0 ? (
        <Body muted>No answers received</Body>
      ) : (
        row.attempts.map((a) => {
          const counts = a.id === row.countingAttemptId;
          return (
            <View key={a.id} style={[styles.attempt, many && counts ? { backgroundColor: colors.primary + "1A" } : null]}>
              <Body>
                {many ? `${a.computerLabel}: ` : ""}
                {a.objectiveScore}/{results.objectiveTotal} · {a.answeredCount} of {results.questionCount} answered · {a.minutesTaken} min
                {a.extraMinutes ? ` (+${a.extraMinutes} min allowed)` : ""}
              </Body>
              {a.flags.length ? (
                <Text style={[styles.flags, { color: colors.warning }]}>
                  {a.flags.map((f) => cbtFlagLabel(f, a.focusLosses)).join(" · ")}
                </Text>
              ) : null}
              {many ? (
                counts ? (
                  <Text style={[styles.counts, { color: colors.primary }]}>Counts</Text>
                ) : canManage ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${a.computerLabel} for ${name}`}
                    disabled={disabled}
                    onPress={() => onChoose(a.id)}
                    style={({ pressed }) => [styles.useThis, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[styles.link, { color: colors.primary }]}>{choosing === a.id ? "Choosing…" : "Use this one"}</Text>
                  </Pressable>
                ) : null
              ) : null}
            </View>
          );
        })
      )}

      <View style={styles.figures}>
        <View style={styles.figure}>
          <Label>Multiple choice</Label>
          <Body>{row.objectiveScore === null ? "—" : `${row.objectiveScore}/${results.objectiveTotal}`}</Body>
        </View>
        {results.onPaperTotal > 0 ? (
          <View style={styles.figure}>
            <Label>Theory (/{results.onPaperTotal})</Label>
            {canManage ? (
              <TextInput
                value={typed}
                onChangeText={onType}
                keyboardType="number-pad"
                maxLength={4}
                accessibilityLabel={`Theory mark for ${name}`}
                style={[
                  styles.markInput,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.card,
                    borderColor: badMark ? colors.danger : colors.border,
                  },
                ]}
              />
            ) : (
              <Body>{typed === "" ? "—" : typed}</Body>
            )}
          </View>
        ) : null}
        <View style={styles.figure}>
          <Label>Total (/{results.paperTotal})</Label>
          {row.total !== null ? <Text style={[styles.total, { color: colors.foreground }]}>{row.total}</Text> : <Caption>{notReady}</Caption>}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  card: { gap: spacing.sm, minWidth: 0 },
  attempt: { gap: 2, borderRadius: radii.sm, padding: spacing.xs, minWidth: 0 },
  flags: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
  counts: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption },
  useThis: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  link: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body, textDecorationLine: "underline" },
  figures: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  figure: { gap: spacing.xs, minWidth: 88, flexShrink: 1 },
  markInput: {
    minHeight: 44,
    width: 80,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  total: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.bodyLarge },
  preview: { gap: spacing.sm, borderRadius: radii.md, padding: spacing.sm },
  previewLine: { fontFamily: fonts.sans, fontSize: fontSizes.body },
  bold: { fontFamily: fonts.sansSemibold },
});
