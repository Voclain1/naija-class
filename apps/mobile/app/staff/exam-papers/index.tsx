import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EXAM_PAPER_TITLE_MAX, type ExamPaperSummaryDto } from "@school-kit/types";

import { LoadError } from "../../../src/components/load-error";
import {
  staffCreateExamPaper,
  staffExamPapers,
  staffPaperQuestionScope,
} from "../../../src/lib/api/staff-exam-papers";
import { staffTeacherScope } from "../../../src/lib/api/staff-attendance";
import { staffGradingScheme } from "../../../src/lib/api/staff-gradebook";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useTermContext } from "../../../src/lib/staff/use-term-context";
import { useTheme } from "../../../src/theme/theme-provider";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, Caption, Card, Heading, Notice, Screen } from "../../../src/components/ui";
import { EmptyState, ListRow, ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";
import { ChoiceChips, TextField } from "../../../src/components/form";

// Exam papers on the phone (docs/modules/phase-8.md §22.3) — the website's
// /teacher/exam-papers. The school's papers, and a form to start one.
//
// A paper is set for the CURRENT term, like the gradebook (no term picker),
// and for a class and subject the caller may work on: the question bank's
// scope (D62). The current term comes from the teacher's own scope; owner and
// admin are refused that teacher-only endpoint, so for them it falls back to
// the school's academic calendar — the website's getCurrentTermForStaff.

const VERSION_CHOICES = [
  { value: "1", label: "One (A)" },
  { value: "2", label: "Two (A–B)" },
  { value: "3", label: "Three (A–C)" },
  { value: "4", label: "Four (A–D)" },
] as const;

const NO_COLUMN = "none";

function describeFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiNetworkError) return "Your phone couldn't reach the server. Nothing changed. Try again when you have signal.";
  if (error instanceof ApiError) return error.message || fallback;
  return fallback;
}

function paperLine(p: ExamPaperSummaryDto): string {
  const questions = `${p.questionCount} question${p.questionCount === 1 ? "" : "s"}`;
  return `${p.classLevelName} · ${p.subjectName} · ${p.termName} · ${questions}, ${p.totalMarks} marks`;
}

export default function ExamPapersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const permissions = staff?.permissions ?? [];
  const canRead = hasPermission(permissions, "exam-paper.read");
  const canWrite = hasPermission(permissions, "exam-paper.write");
  const ready = authed && canRead && schoolId !== "" && userId !== "";

  const papers = useQuery({
    queryKey: queryKeys.staffExamPapers(schoolId, userId),
    queryFn: staffExamPapers,
    enabled: ready,
    staleTime: 30_000,
  });
  const scope = useQuery({
    queryKey: queryKeys.staffQuestionScope(schoolId, userId),
    queryFn: staffPaperQuestionScope,
    enabled: ready && canWrite,
    staleTime: 10 * 60_000,
  });
  const teacherScope = useQuery({
    queryKey: queryKeys.staffScope(schoolId, userId),
    queryFn: staffTeacherScope,
    enabled: ready && canWrite,
    staleTime: 10 * 60_000,
    retry: false,
  });
  // Only when the teacher scope is refused (owner, admin) — see the header.
  const termContext = useTermContext({ schoolId, userId, enabled: ready && canWrite && teacherScope.isError });
  const scheme = useQuery({
    queryKey: queryKeys.staffGradingScheme(schoolId, userId),
    queryFn: staffGradingScheme,
    enabled: ready && canWrite,
    staleTime: 10 * 60_000,
  });

  const term: { id: string; name: string } | null | undefined = teacherScope.data
    ? teacherScope.data.currentTerm
      ? { id: teacherScope.data.currentTerm.id, name: teacherScope.data.currentTerm.name }
      : null
    : teacherScope.isError
      ? termContext.data
        ? termContext.data.term
          ? { id: termContext.data.term.termId, name: termContext.data.term.termName }
          : null
        : termContext.isError
          ? null
          : undefined
      : undefined;

  const components = scheme.data?.components ?? [];

  const [levelId, setLevelId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("90");
  const [versions, setVersions] = useState<string>("1");
  const [componentId, setComponentId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // A teacher with exactly one (class, subject) has it chosen for them.
  useEffect(() => {
    const s = scope.data;
    if (!s || s.all || s.pairs.length !== 1 || levelId !== null) return;
    setLevelId(s.pairs[0]!.classLevelId);
    setSubjectId(s.pairs[0]!.subjectId);
  }, [scope.data, levelId]);

  // The usual home for an exam's marks, chosen for them.
  useEffect(() => {
    if (componentId !== null || !scheme.data) return;
    setComponentId(scheme.data.components.find((c) => c.key === "exam")?.id ?? NO_COLUMN);
  }, [scheme.data, componentId]);

  const subjectChoices = useMemo(() => {
    const s = scope.data;
    if (!s) return [];
    if (s.all) return s.subjects;
    const taught = new Set(s.pairs.filter((p) => p.classLevelId === levelId).map((p) => p.subjectId));
    return s.subjects.filter((sub) => taught.has(sub.id));
  }, [scope.data, levelId]);

  const create = useMutation({
    mutationFn: () =>
      staffCreateExamPaper({
        classLevelId: levelId ?? "",
        subjectId: subjectId ?? "",
        termId: term?.id ?? "",
        title: title.trim(),
        durationMinutes: Number(duration),
        versionCount: Number(versions),
        componentId: componentId && componentId !== NO_COLUMN ? componentId : null,
      }),
    onMutate: () => setFormError(null),
    onSuccess: (paper) => {
      setTitle("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.staffExamPapers(schoolId, userId) });
      queryClient.setQueryData(queryKeys.staffExamPaper(schoolId, userId, paper.id), paper);
      router.push(`/staff/exam-papers/${paper.id}`);
    },
    onError: (error) => setFormError(describeFailure(error, "Could not start the paper. Try again.")),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  if (!canRead) {
    return (
      <Screen>
        <ScreenHeader title="Exam papers" />
        <Notice tone="info">Exam papers are set by teachers and administrators.</Notice>
      </Screen>
    );
  }

  const durationOk = /^\d+$/.test(duration) && Number(duration) >= 5 && Number(duration) <= 600;
  const canCreate = Boolean(term && levelId && subjectId && title.trim() && durationOk && !create.isPending);

  function startForm() {
    const s = scope.data;
    if (scope.isPending || term === undefined) return <Skeleton lines={4} />;
    if (scope.isError) {
      return <LoadError error={scope.error} what="the classes and subjects you can set papers for" onRetry={() => void scope.refetch()} />;
    }
    if (!s) return null;
    if (term === null) return <Body muted>There is no current term yet. Ask an admin to set one first.</Body>;
    if (s.levels.length === 0 || s.subjects.length === 0) {
      return (
        <Body muted>
          {s.all ? "Set up class levels and subjects under Academics first." : "You aren't assigned to teach any subject yet."}
        </Body>
      );
    }
    return (
      <View style={styles.form}>
        <ChoiceChips
          label="Class"
          options={s.levels.map((l) => ({ value: l.id, label: l.name }))}
          value={levelId}
          onChange={(next) => {
            setLevelId(next);
            setSubjectId(null);
          }}
        />
        {levelId !== null ? (
          subjectChoices.length === 0 ? (
            <Body muted>You don&apos;t teach a subject in this class.</Body>
          ) : (
            <ChoiceChips
              label="Subject"
              options={subjectChoices.map((sub) => ({ value: sub.id, label: sub.name }))}
              value={subjectId}
              onChange={setSubjectId}
            />
          )
        ) : null}
        <TextField
          label="Title"
          value={title}
          onChangeText={setTitle}
          maxLength={EXAM_PAPER_TITLE_MAX}
          placeholder={`e.g. ${term.name} Examination`}
          autoCapitalize="sentences"
        />
        <TextField
          label="Time allowed (minutes)"
          value={duration}
          onChangeText={setDuration}
          keyboardType="number-pad"
          maxLength={3}
          error={duration !== "" && !durationOk ? "A whole number of minutes, from 5 to 600." : null}
        />
        <ChoiceChips
          label="Versions"
          options={VERSION_CHOICES.map((v) => ({ value: v.value, label: v.label }))}
          value={versions}
          onChange={setVersions}
        />
        <ChoiceChips
          label="Gradebook column"
          options={[{ value: NO_COLUMN, label: "None" }, ...components.map((c) => ({ value: c.id, label: c.label }))]}
          value={componentId ?? NO_COLUMN}
          onChange={setComponentId}
        />
        <Caption>
          For {term.name}. Once the paper is final, its total marks become the “Out of” for that gradebook column.
        </Caption>
        {formError ? <Notice tone="danger">{formError}</Notice> : null}
        <Button
          title={create.isPending ? "Starting…" : "Start paper"}
          loading={create.isPending}
          disabled={!canCreate}
          onPress={() => create.mutate()}
        />
      </View>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={papers.isRefetching} onRefresh={() => void papers.refetch()} tintColor={colors.primary} />
          }
        >
          <ScreenHeader
            title="Exam papers"
            subtitle="Set a paper from your approved questions, finalise it, then print it or share it as a PDF or CSV — with up to four versions, each with its own marking scheme."
          />

          {canWrite ? (
            <Card>
              <Heading>Start a paper</Heading>
              {startForm()}
            </Card>
          ) : null}

          <SectionHeader title="Papers" />
          {papers.isPending ? (
            <Skeleton lines={4} />
          ) : papers.isError && !papers.data ? (
            <LoadError error={papers.error} what="the exam papers" onRetry={() => void papers.refetch()} />
          ) : (papers.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="document-text-outline"
              title="No papers yet"
              body={canWrite ? "Start one above. It stays a draft until you finalise it." : "Papers your school sets appear here."}
            />
          ) : (
            papers.data!.map((p) => (
              <ListRow
                key={p.id}
                icon="document-text-outline"
                title={p.title}
                subtitle={paperLine(p)}
                meta={p.status === "FINAL" ? "Final" : "Draft"}
                onPress={() => router.push(`/staff/exam-papers/${p.id}`)}
              />
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  form: { gap: spacing.sm, marginTop: spacing.sm },
});
