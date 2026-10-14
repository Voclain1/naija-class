import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import {
  EXAM_PAPER_DRAW_MAX,
  EXAM_PAPER_INSTRUCTIONS_MAX,
  EXAM_PAPER_TITLE_MAX,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  versionsOf,
  type ExamPaperDto,
  type PaperVersion,
  type QuestionDto,
  type QuestionType,
} from "@school-kit/types";

import { LoadError } from "../../../src/components/load-error";
import {
  staffDeleteExamPaper,
  staffDrawExamQuestions,
  staffDuplicateExamPaper,
  staffExamPaper,
  staffExamPaperExport,
  staffFinaliseExamPaper,
  staffPaperBankQuestions,
  staffSaveExamPaper,
} from "../../../src/lib/api/staff-exam-papers";
import { staffGradingScheme } from "../../../src/lib/api/staff-gradebook";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import {
  addQuestions,
  addSection,
  defaultQuestionType,
  editorFromPaper,
  editorMarks,
  editorToInput,
  isEditorDirty,
  moveQuestion,
  removeQuestion,
  removeSection,
  usedQuestionIds,
  type EditorSection,
  type PaperEditorState,
} from "../../../src/lib/staff/paper-editor";
import {
  paperCsv,
  paperDocumentTitle,
  paperFilename,
  paperPrintHtml,
  type PaperDocumentKind,
} from "../../../src/lib/staff/paper-export";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import { Body, Button, Caption, Card, Heading, Label, Notice, Screen } from "../../../src/components/ui";
import { ScreenHeader, Skeleton } from "../../../src/components/layout";
import { ChoiceChips, TextField } from "../../../src/components/form";

// One exam paper on the phone (docs/modules/phase-8.md §22.3) — the website's
// /teacher/exam-papers/[id].
//
// A DRAFT is edited here locally and saved whole (one PUT), exactly as on the
// web: the editor's moves are the web's own pure rules (paper-editor.ts).
// Finalising freezes it — in the database too — after which it can only be
// printed, exported or duplicated. A FINAL paper never changes, so what was
// printed and what is stored always agree.
//
// Unsaved edits live in this screen's memory only. Leaving with some asks
// first; the app locking or closing loses them, as on the website, so the
// Save bar stays on screen while there is anything to save.
//
// Exports (FINAL only, `exam-paper.read`): fetched fresh for each one, so the
// API audits every export. The page is built on the phone from the export
// data — the website does the same; the API returns data, not a document —
// and turned into a PDF by expo-print, or printed. The PDF or CSV is written
// to the phone's cache for the share sheet and deleted as soon as it closes:
// an exam paper is exam content before it is sat.

const VERSION_COUNT_CHOICES = [
  { value: "1", label: "A" },
  { value: "2", label: "A–B" },
  { value: "3", label: "A–C" },
  { value: "4", label: "A–D" },
] as const;

const NO_COLUMN = "none";

function describeFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiNetworkError) return "Your phone couldn't reach the server. Nothing changed. Try again when you have signal.";
  if (error instanceof ApiError) return error.message || fallback;
  return fallback;
}

const marksText = (n: number) => `${n} mark${n === 1 ? "" : "s"}`;

export default function ExamPaperScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const permissions = staff?.permissions ?? [];
  const canRead = hasPermission(permissions, "exam-paper.read");
  const canWrite = hasPermission(permissions, "exam-paper.write");
  const canFinalise = hasPermission(permissions, "exam-paper.finalise");
  const ready = authed && canRead && schoolId !== "" && userId !== "" && !!id;

  const paperKey = queryKeys.staffExamPaper(schoolId, userId, id ?? "");
  const paperQuery = useQuery({
    queryKey: paperKey,
    queryFn: () => staffExamPaper(id as string),
    enabled: ready,
    staleTime: 30_000,
  });
  const scheme = useQuery({
    queryKey: queryKeys.staffGradingScheme(schoolId, userId),
    queryFn: staffGradingScheme,
    enabled: ready && canWrite,
    staleTime: 10 * 60_000,
  });

  const [paper, setPaper] = useState<ExamPaperDto | null>(null);
  const [saved, setSaved] = useState<PaperEditorState | null>(null);
  const [state, setState] = useState<PaperEditorState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const applied = useRef<ExamPaperDto | null>(null);
  const leaving = useRef(false);

  const isDraft = paper?.status === "DRAFT";
  const editable = Boolean(isDraft && canWrite);
  const dirty = Boolean(editable && state && saved && isEditorDirty(state, saved));

  const applyPaper = useCallback((next: ExamPaperDto) => {
    applied.current = next;
    setPaper(next);
    const editor = editorFromPaper(next);
    setSaved(editor);
    setState(editor);
  }, []);

  // Take the server's copy when it arrives or is refreshed — but never over
  // unsaved edits.
  useEffect(() => {
    const next = paperQuery.data;
    if (!next || next === applied.current || dirty) return;
    applyPaper(next);
  }, [paperQuery.data, dirty, applyPaper]);

  // Unsaved edits to a draft are lost on leaving; say so first.
  useEffect(() => {
    if (!dirty) return;
    return navigation.addListener("beforeRemove", (event) => {
      if (leaving.current) return;
      event.preventDefault();
      Alert.alert("Leave without saving?", "Your changes to this paper have not been saved.", [
        { text: "Stay", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => navigation.dispatch(event.data.action) },
      ]);
    });
  }, [navigation, dirty]);

  const marks = useMemo(() => (state ? editorMarks(state) : { sections: [], total: 0 }), [state]);

  const listKey = queryKeys.staffExamPapers(schoolId, userId);
  const afterChange = (next: ExamPaperDto) => {
    applyPaper(next);
    queryClient.setQueryData(paperKey, next);
    void queryClient.invalidateQueries({ queryKey: listKey });
  };

  const save = useMutation({
    mutationFn: (input: Parameters<typeof staffSaveExamPaper>[1]) => staffSaveExamPaper(id as string, input),
    onMutate: () => {
      setSaveError(null);
      setActionError(null);
      setNotice(null);
    },
    onSuccess: (next) => {
      afterChange(next);
      setNotice("Paper saved.");
    },
  });
  const finalise = useMutation({
    mutationFn: () => staffFinaliseExamPaper(id as string),
    onMutate: () => {
      setActionError(null);
      setNotice(null);
    },
    onSuccess: (next) => {
      afterChange(next);
      setNotice("Paper finalised.");
    },
    onError: (error) => setActionError(describeFailure(error, "Couldn't finalise the paper.")),
  });
  const duplicate = useMutation({
    mutationFn: () => staffDuplicateExamPaper(id as string),
    onMutate: () => {
      setActionError(null);
      setNotice(null);
    },
    onSuccess: (copy) => {
      queryClient.setQueryData(queryKeys.staffExamPaper(schoolId, userId, copy.id), copy);
      void queryClient.invalidateQueries({ queryKey: listKey });
      router.push(`/staff/exam-papers/${copy.id}`);
    },
    onError: (error) => setActionError(describeFailure(error, "Couldn't duplicate the paper.")),
  });
  const remove = useMutation({
    mutationFn: () => staffDeleteExamPaper(id as string),
    onMutate: () => {
      setActionError(null);
      setNotice(null);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
      queryClient.removeQueries({ queryKey: paperKey });
      leaving.current = true;
      if (router.canGoBack()) router.back();
      else router.replace("/staff/exam-papers");
    },
    onError: (error) => setActionError(describeFailure(error, "Couldn't delete the paper.")),
  });

  const busy = save.isPending || finalise.isPending || duplicate.isPending || remove.isPending;

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (!canRead) {
    return (
      <Screen>
        {header}
        <Notice tone="info">Exam papers are set by teachers and administrators.</Notice>
      </Screen>
    );
  }

  if (paperQuery.error instanceof ApiError && paperQuery.error.status === 404) {
    return (
      <Screen>
        {header}
        <Notice tone="info">This paper no longer exists, or it isn&apos;t one you can open.</Notice>
      </Screen>
    );
  }

  if (!paper || !state) {
    return (
      <Screen>
        {header}
        {paperQuery.isError ? (
          <LoadError error={paperQuery.error} what="the paper" onRetry={() => void paperQuery.refetch()} />
        ) : (
          <Skeleton lines={6} />
        )}
      </Screen>
    );
  }

  const components = scheme.data?.components ?? [];

  const set = <K extends keyof PaperEditorState>(key: K, value: PaperEditorState[K]) =>
    setState((s) => (s ? { ...s, [key]: value } : s));
  const setSection = (i: number, patch: Partial<EditorSection>) =>
    setState((s) => (s ? { ...s, sections: s.sections.map((sec, j) => (j === i ? { ...sec, ...patch } : sec)) } : s));

  async function onSave(): Promise<boolean> {
    if (!state) return false;
    const result = editorToInput(state);
    if (!result.ok) {
      setSaveError(result.message);
      return false;
    }
    try {
      await save.mutateAsync(result.input);
      return true;
    } catch (error) {
      setSaveError(describeFailure(error, "Couldn't save the paper. Try again."));
      return false;
    }
  }

  async function onFinalise(): Promise<void> {
    if (dirty && !(await onSave())) return;
    Alert.alert("Finalise this paper?", "It can then be printed and exported, but never changed — only duplicated.", [
      { text: "Cancel", style: "cancel" },
      { text: "Finalise", onPress: () => finalise.mutate() },
    ]);
  }

  function onDelete(): void {
    Alert.alert("Delete this draft paper?", "The questions stay in the bank.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete draft", style: "destructive", onPress: () => remove.mutate() },
    ]);
  }

  const statusLine = isDraft
    ? `Draft · ${marksText(dirty ? marks.total : paper.totalMarks)}`
    : `Final${paper.finalisedByName ? ` · ${paper.finalisedByName}` : ""} · ${marksText(paper.totalMarks)}`;
  const disabled = !editable || busy;
  const columnLabel = paper.componentLabel ?? components.find((c) => c.id === paper.componentId)?.label ?? null;
  const versionText = VERSION_COUNT_CHOICES.find((v) => v.value === String(paper.versionCount))?.label ?? "A";

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={paperQuery.isRefetching}
              onRefresh={() => void paperQuery.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <ScreenHeader title={paper.title} subtitle={`${paper.classLevelName} · ${paper.subjectName} · ${paper.termName}`} />
          <View style={[styles.statusPill, { backgroundColor: (isDraft ? colors.mutedForeground : colors.primary) + "1A" }]}>
            {!isDraft ? <Ionicons name="lock-closed" size={14} color={colors.primary} /> : null}
            <Text style={[styles.statusText, { color: isDraft ? colors.foreground : colors.primary }]}>{statusLine}</Text>
          </View>

          {notice ? <Notice tone="info">{notice}</Notice> : null}
          {actionError ? <Notice tone="danger">{actionError}</Notice> : null}

          {!isDraft ? <ExportCard paper={paper} /> : null}

          {/* ---- Header fields ---- */}
          <Card>
            <Heading>Paper details</Heading>
            {editable ? (
              <View style={styles.form}>
                <TextField label="Title" value={state.title} onChangeText={(v) => set("title", v)} maxLength={EXAM_PAPER_TITLE_MAX} autoCapitalize="sentences" />
                <TextField label="Minutes" value={state.durationMinutes} onChangeText={(v) => set("durationMinutes", v)} keyboardType="number-pad" maxLength={3} />
                <ChoiceChips
                  label="Versions"
                  options={VERSION_COUNT_CHOICES.map((v) => ({ value: v.value, label: v.label }))}
                  value={String(state.versionCount)}
                  onChange={(v) => set("versionCount", Number(v))}
                />
                <ChoiceChips
                  label="Gradebook column"
                  options={[{ value: NO_COLUMN, label: "None" }, ...components.map((c) => ({ value: c.id, label: c.label }))]}
                  value={state.componentId || NO_COLUMN}
                  onChange={(v) => set("componentId", v === NO_COLUMN ? "" : v)}
                />
                <TextField
                  label="General instructions"
                  value={state.instructions}
                  onChangeText={(v) => set("instructions", v)}
                  multiline
                  maxLength={EXAM_PAPER_INSTRUCTIONS_MAX}
                  autoCapitalize="sentences"
                />
              </View>
            ) : (
              <View style={styles.form}>
                <Body>Time allowed: {paper.durationMinutes} minutes</Body>
                <Body>Versions: {versionText}</Body>
                <Body>Gradebook column: {columnLabel ?? "None"}</Body>
                {paper.instructions ? (
                  <View style={styles.readBlock}>
                    <Label>General instructions</Label>
                    <Body>{paper.instructions}</Body>
                  </View>
                ) : null}
              </View>
            )}
          </Card>

          {/* ---- Sections ---- */}
          {state.sections.map((section, si) => (
            <Card key={section.key}>
              {editable ? (
                <>
                  <TextField label="Section title" value={section.title} onChangeText={(v) => setSection(si, { title: v })} maxLength={EXAM_PAPER_TITLE_MAX} />
                  <TextField
                    label="Section instructions"
                    value={section.instructions}
                    onChangeText={(v) => setSection(si, { instructions: v })}
                    maxLength={EXAM_PAPER_INSTRUCTIONS_MAX}
                  />
                </>
              ) : (
                <>
                  <Heading>{section.title}</Heading>
                  {section.instructions ? <Body muted>{section.instructions}</Body> : null}
                </>
              )}
              <Caption>{marksText(marks.sections[si] ?? 0)}</Caption>

              {section.questions.length === 0 ? (
                <Body muted>No questions in this section yet.</Body>
              ) : (
                section.questions.map((q, qi) => (
                  <QuestionRow
                    key={q.id}
                    number={qi + 1}
                    question={q}
                    editable={editable}
                    disabled={disabled}
                    first={qi === 0}
                    last={qi === section.questions.length - 1}
                    onUp={() => setState((s) => (s ? moveQuestion(s, si, qi, -1) : s))}
                    onDown={() => setState((s) => (s ? moveQuestion(s, si, qi, 1) : s))}
                    onRemove={() => setState((s) => (s ? removeQuestion(s, si, qi) : s))}
                  />
                ))
              )}

              {editable ? (
                <View style={styles.stack}>
                  <Button title="Add questions" variant="secondary" disabled={disabled} onPress={() => setPicking(si)} />
                  <Button
                    title="Remove section"
                    variant="secondary"
                    disabled={disabled || state.sections.length === 1}
                    onPress={() => setState((s) => (s ? removeSection(s, si) : s))}
                  />
                </View>
              ) : null}
            </Card>
          ))}

          {editable ? (
            <>
              <Button title="Add a section" variant="secondary" disabled={disabled} onPress={() => setState((s) => (s ? addSection(s) : s))} />

              {paper.problems.length > 0 && !dirty ? (
                <Card style={{ backgroundColor: colors.warning + "26" }}>
                  <Label>Before finalising</Label>
                  {paper.problems.map((p) => (
                    <Body key={p}>{p}</Body>
                  ))}
                </Card>
              ) : null}

              {canFinalise ? (
                <Button
                  title={finalise.isPending ? "Finalising…" : "Finalise"}
                  loading={finalise.isPending}
                  disabled={busy || (!dirty && paper.problems.length > 0)}
                  onPress={() => void onFinalise()}
                />
              ) : null}
              <Button title="Delete draft" variant="secondary" loading={remove.isPending} disabled={busy} onPress={onDelete} />
            </>
          ) : !isDraft && canWrite ? (
            <Button
              title={duplicate.isPending ? "Copying…" : "Duplicate to edit"}
              variant="secondary"
              loading={duplicate.isPending}
              disabled={busy}
              onPress={() => duplicate.mutate()}
            />
          ) : null}
        </ScrollView>

        {editable && (dirty || saveError) ? (
          <View style={[styles.saveBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
            {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
            {dirty ? <Caption>Unsaved changes</Caption> : null}
            <Button
              title={save.isPending ? "Saving…" : "Save"}
              loading={save.isPending}
              disabled={!dirty || busy}
              onPress={() => void onSave()}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {picking !== null ? (
        <QuestionPicker
          sectionTitle={state.sections[picking]?.title || "this section"}
          subjectId={paper.subjectId}
          classLevelId={paper.classLevelId}
          schoolId={schoolId}
          userId={userId}
          usedIds={usedQuestionIds(state)}
          defaultType={defaultQuestionType(state, picking)}
          onClose={() => setPicking(null)}
          onAdd={(qs) => {
            const index = picking;
            setState((s) => (s ? addQuestions(s, index, qs) : s));
            setPicking(null);
          }}
        />
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One question on the paper. Retired since it was added: tinted, and said in
// words (no accent borders, CLAUDE.md).

function QuestionRow({
  number,
  question,
  editable,
  disabled,
  first,
  last,
  onUp,
  onDown,
  onRemove,
}: {
  number: number;
  question: QuestionDto;
  editable: boolean;
  disabled: boolean;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const retired = question.status !== "APPROVED";
  return (
    <View style={[styles.question, { backgroundColor: retired ? colors.warning + "26" : colors.mutedForeground + "14" }]}>
      <View style={styles.questionHead}>
        <Text style={[styles.questionNumber, { color: colors.foreground }]}>{number}.</Text>
        <View style={styles.questionText}>
          <Body>{question.text}</Body>
          <Caption>
            {QUESTION_TYPE_LABELS[question.type]} · {marksText(question.marks)} · {question.topic}
          </Caption>
          {retired ? <Body>Retired since it was added — replace it before finalising.</Body> : null}
        </View>
      </View>
      {editable ? (
        <View style={styles.questionActions}>
          <IconButton icon="arrow-up" label={`Move question ${number} up`} disabled={disabled || first} onPress={onUp} />
          <IconButton icon="arrow-down" label={`Move question ${number} down`} disabled={disabled || last} onPress={onDown} />
          <IconButton icon="close" label={`Remove question ${number}`} disabled={disabled} onPress={onRemove} />
        </View>
      ) : null}
    </View>
  );
}

function IconButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "arrow-up" | "arrow-down" | "close";
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        { borderColor: colors.border, opacity: disabled ? 0.35 : pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Print and export a FINAL paper, one version at a time (D63) — the website's
// ExportPanel. Every export is fetched fresh from the API, which audits it.

type Busy = `${PaperDocumentKind}-${"pdf" | "print"}` | "csv" | null;

function ExportCard({ paper }: { paper: ExamPaperDto }) {
  const versions = versionsOf(paper.versionCount);
  const [version, setVersion] = useState<PaperVersion>("A");
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const fail = (error: unknown) => setFailure(describeFailure(error, "Couldn't export the paper. Try again."));

  async function sharePdf(kind: PaperDocumentKind): Promise<void> {
    setBusy(`${kind}-pdf`);
    setFailure(null);
    const files: string[] = [];
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setFailure("This phone can't share files. Use Print instead.");
        return;
      }
      const data = await staffExamPaperExport(paper.id, version);
      const { uri } = await Print.printToFileAsync({ html: paperPrintHtml(data, kind) });
      files.push(uri);
      // Give the PDF the paper's name, so it arrives in WhatsApp or email as
      // "ss-1-physics-…-marking-scheme.pdf" rather than a random id.
      let shared = uri;
      if (FileSystem.cacheDirectory) {
        const named = `${FileSystem.cacheDirectory}${paperFilename(data, kind, "pdf")}`;
        await FileSystem.deleteAsync(named, { idempotent: true });
        await FileSystem.moveAsync({ from: uri, to: named });
        files.push(named);
        shared = named;
      }
      await Sharing.shareAsync(shared, {
        mimeType: "application/pdf",
        dialogTitle: paperDocumentTitle(data, kind),
        UTI: "com.adobe.pdf",
      });
    } catch (error) {
      fail(error);
    } finally {
      for (const file of files) await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => undefined);
      setBusy(null);
    }
  }

  async function print(kind: PaperDocumentKind): Promise<void> {
    setBusy(`${kind}-print`);
    setFailure(null);
    try {
      const data = await staffExamPaperExport(paper.id, version);
      await Print.printAsync({ html: paperPrintHtml(data, kind) });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }

  async function shareCsv(): Promise<void> {
    setBusy("csv");
    setFailure(null);
    let file: string | null = null;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setFailure("This phone can't share files. Use Print instead.");
        return;
      }
      const data = await staffExamPaperExport(paper.id, version);
      const name = paperFilename(data, "paper", "csv");
      file = `${FileSystem.cacheDirectory ?? ""}${name}`;
      // A leading BOM so Excel reads it as UTF-8, as the website's download does.
      await FileSystem.writeAsStringAsync(file, `﻿${paperCsv(data)}`);
      await Sharing.shareAsync(file, { mimeType: "text/csv", dialogTitle: name, UTI: "public.comma-separated-values-text" });
    } catch (error) {
      fail(error);
    } finally {
      if (file) await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => undefined);
      setBusy(null);
    }
  }

  return (
    <Card>
      <Heading>Print and export</Heading>
      {versions.length > 1 ? (
        <>
          <ChoiceChips
            label="Version"
            options={versions.map((v) => ({ value: v, label: `Version ${v}` }))}
            value={version}
            onChange={setVersion}
          />
          <Caption>Each version orders the multiple-choice options differently. Print each version&apos;s own marking scheme.</Caption>
        </>
      ) : null}
      <Label>Question paper</Label>
      <Button title="Share as PDF" loading={busy === "paper-pdf"} disabled={busy !== null} onPress={() => void sharePdf("paper")} />
      <Button title="Print" variant="secondary" loading={busy === "paper-print"} disabled={busy !== null} onPress={() => void print("paper")} />
      <Label>Marking scheme</Label>
      <Button title="Share as PDF" variant="secondary" loading={busy === "scheme-pdf"} disabled={busy !== null} onPress={() => void sharePdf("scheme")} />
      <Button title="Print" variant="secondary" loading={busy === "scheme-print"} disabled={busy !== null} onPress={() => void print("scheme")} />
      <Label>For a CBT system or spreadsheet</Label>
      <Button title="Share as CSV" variant="secondary" loading={busy === "csv"} disabled={busy !== null} onPress={() => void shareCsv()} />
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Add APPROVED questions from the bank to one section — the website's
// QuestionPickerDialog, as a full-screen sheet: tick them by hand, or draw
// some at random by type (and topic). Questions already on the paper are not
// offered.

function QuestionPicker({
  sectionTitle,
  subjectId,
  classLevelId,
  schoolId,
  userId,
  usedIds,
  defaultType,
  onClose,
  onAdd,
}: {
  sectionTitle: string;
  subjectId: string;
  classLevelId: string;
  schoolId: string;
  userId: string;
  usedIds: string[];
  defaultType: QuestionType;
  onClose: () => void;
  onAdd: (questions: QuestionDto[]) => void;
}) {
  const { colors } = useTheme();
  const [type, setType] = useState<QuestionType>(defaultType);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [drawCount, setDrawCount] = useState("10");
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search as the teacher types, without a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const bank = useQuery({
    queryKey: queryKeys.staffQuestions(schoolId, userId, `exam-paper|${subjectId}|${classLevelId}|${type}|APPROVED|${query}`),
    queryFn: () => staffPaperBankQuestions({ subjectId, classLevelId, type, status: "APPROVED", q: query || undefined }),
    staleTime: 30_000,
  });

  const used = useMemo(() => new Set(usedIds), [usedIds]);
  const available = (bank.data ?? []).filter((q) => !used.has(q.id));

  async function onDraw(): Promise<void> {
    setDrawing(true);
    setError(null);
    try {
      const drawn = await staffDrawExamQuestions({
        subjectId,
        classLevelId,
        type,
        topic: search.trim() || undefined,
        count: Math.max(1, Math.min(EXAM_PAPER_DRAW_MAX, Number(drawCount) || 1)),
        excludeIds: usedIds,
      });
      if (drawn.length === 0) {
        setError("There are no unused approved questions of that kind to draw from.");
        return;
      }
      onAdd(drawn);
    } catch (e) {
      setError(describeFailure(e, "Could not draw questions."));
    } finally {
      setDrawing(false);
    }
  }

  function toggle(questionId: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }

  const typeLabel = QUESTION_TYPE_LABELS[type].toLowerCase();

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <Screen>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ScreenHeader
              title={`Add questions to ${sectionTitle}`}
              subtitle="Approved questions from the bank. Questions already on this paper are not shown."
            />
            <ChoiceChips
              label="Type"
              options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABELS[t] }))}
              value={type}
              onChange={(next) => {
                setType(next);
                setPicked(new Set());
              }}
            />
            <TextField label="Topic or text" value={search} onChangeText={setSearch} placeholder="Filter, or leave blank for all" maxLength={100} />

            <Card>
              <Label>Draw at random</Label>
              <TextField label="How many" value={drawCount} onChangeText={setDrawCount} keyboardType="number-pad" maxLength={2} />
              <Button
                title={`Draw ${typeLabel} questions`}
                variant="secondary"
                loading={drawing}
                disabled={drawing}
                onPress={() => void onDraw()}
              />
              <Caption>From the unused approved questions matching the filter.</Caption>
            </Card>

            {error ? <Notice tone="danger">{error}</Notice> : null}

            {bank.isPending ? (
              <Skeleton lines={4} />
            ) : bank.isError ? (
              <LoadError error={bank.error} what="the question bank" onRetry={() => void bank.refetch()} />
            ) : available.length === 0 ? (
              <Body muted>No unused approved questions of this kind.</Body>
            ) : (
              available.map((q) => {
                const checked = picked.has(q.id);
                return (
                  <Pressable
                    key={q.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={q.text}
                    onPress={() => toggle(q.id)}
                    style={({ pressed }) => [
                      styles.pickRow,
                      {
                        backgroundColor: checked ? colors.primary + "1A" : colors.card,
                        borderColor: colors.border,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={colors.primary} />
                    <View style={styles.questionText}>
                      <Body>{q.text}</Body>
                      <Caption>
                        {q.topic} · {marksText(q.marks)}
                      </Caption>
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={[styles.saveBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
            <Button
              title={picked.size > 0 ? `Add ${picked.size} selected` : "Add selected"}
              disabled={picked.size === 0}
              onPress={() => onAdd(available.filter((q) => picked.has(q.id)))}
            />
            <Button title="Cancel" variant="secondary" onPress={onClose} />
          </View>
        </KeyboardAvoidingView>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  form: { gap: spacing.sm, marginTop: spacing.xs },
  stack: { gap: spacing.sm },
  readBlock: { gap: spacing.xs },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    maxWidth: "100%",
  },
  statusText: { fontFamily: fonts.sansMedium, fontSize: fontSizes.caption, flexShrink: 1 },
  question: { borderRadius: radii.md, padding: spacing.sm, gap: spacing.sm },
  questionHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  questionNumber: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body, minWidth: 24 },
  questionText: { flex: 1, minWidth: 0, gap: spacing.xs },
  questionActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.sm },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  pickRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  saveBar: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
