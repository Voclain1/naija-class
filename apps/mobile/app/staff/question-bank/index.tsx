import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QUESTION_TYPE_LABELS, type QuestionDto } from "@school-kit/types";

import {
  approveStaffQuestion,
  discardStaffQuestion,
  retireStaffQuestion,
  staffQuestionScope,
  staffQuestions,
} from "../../../src/lib/api/staff-questions";
import { ApiError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { OPTION_LETTERS, subjectChoicesFor } from "../../../src/lib/staff/question-form";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import { Body, Button, Caption, Card, Heading, Label, Notice, Screen } from "../../../src/components/ui";
import { EmptyState, ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";
import { ChoiceChips, TextField } from "../../../src/components/form";
import { LoadError } from "../../../src/components/load-error";

// The question bank, on the phone (Phase 8c / CP5b, docs/modules/phase-8.md
// §22.2) — the same bank as apps/web's /teacher/question-bank, with the same
// words. One class level and subject at a time; drafts, approved and retired
// questions as three lists.
//
// AI drafting lives on its own screen (generate.tsx) and writing or editing
// a question on another (edit.tsx), because a long form under a long list
// does not fit a phone. Every AI draft arrives as a DRAFT and is labelled so in
// words: nothing the model wrote reaches a paper until a person approves it
// (the AI hard rule in CLAUDE.md).
//
// The buttons are offered by permission (question.write, question.approve,
// question.generate) — a display decision only; the server checks each one.

type Tab = "DRAFT" | "APPROVED" | "RETIRED";
const TAB_LABELS: Record<Tab, string> = { DRAFT: "Drafts to review", APPROVED: "Approved", RETIRED: "Retired" };
const DIFFICULTY = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" } as const;

type QuestionAction = "approve" | "discard" | "retire";

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

export default function QuestionBankScreen() {
  const { status, principal, staff } = useSession();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const permissions = staff?.permissions ?? [];
  const canRead = hasPermission(permissions, "question.read");
  const canWrite = hasPermission(permissions, "question.write");
  const canApprove = hasPermission(permissions, "question.approve");
  const canGenerate = hasPermission(permissions, "question.generate");
  const ready = authed && schoolId !== "" && userId !== "" && canRead;

  const [levelId, setLevelId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("DRAFT");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);

  // Search as the teacher types, but not one request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const scope = useQuery({
    queryKey: queryKeys.staffQuestionScope(schoolId, userId),
    queryFn: staffQuestionScope,
    enabled: ready,
    staleTime: 10 * 60_000,
  });

  // A teacher with exactly one (level, subject) pair goes straight to it.
  useEffect(() => {
    const s = scope.data;
    if (s && !s.all && s.pairs.length === 1 && levelId === null) {
      setLevelId(s.pairs[0]!.classLevelId);
      setSubjectId(s.pairs[0]!.subjectId);
    }
  }, [scope.data, levelId]);

  const subjectChoices = useMemo(
    () => (scope.data ? subjectChoicesFor(scope.data, levelId) : []),
    [scope.data, levelId],
  );

  const pair = useMemo(() => {
    if (!scope.data || !levelId || !subjectId) return null;
    const level = scope.data.levels.find((l) => l.id === levelId);
    const subject = subjectChoices.find((s) => s.id === subjectId);
    return level && subject ? { levelId: level.id, levelName: level.name, subjectId: subject.id, subjectName: subject.name } : null;
  }, [scope.data, levelId, subjectId, subjectChoices]);

  // Drafts and approved come back together (the web's single list, so both
  // tabs show their counts); retired is its own request, fetched only when
  // that tab is open.
  const retiredTab = tab === "RETIRED";
  const filter = `${pair?.levelId ?? ""}|${pair?.subjectId ?? ""}|${retiredTab ? "RETIRED" : "CURRENT"}|${query}`;
  const list = useQuery({
    queryKey: queryKeys.staffQuestions(schoolId, userId, filter),
    queryFn: () =>
      staffQuestions({
        classLevelId: pair!.levelId,
        subjectId: pair!.subjectId,
        q: query || undefined,
        status: retiredTab ? "RETIRED" : undefined,
      }),
    enabled: ready && pair !== null,
    staleTime: 30_000,
  });

  const questionsPrefix = queryKeys.staffQuestions(schoolId, userId, "").slice(0, 4);

  const act = useMutation({
    mutationFn: async ({ question, action }: { question: QuestionDto; action: QuestionAction }) => {
      if (action === "approve") await approveStaffQuestion(question.id);
      else if (action === "discard") await discardStaffQuestion(question.id);
      else await retireStaffQuestion(question.id);
    },
    onMutate: () => setMessage(null),
    onSuccess: (_data, { question, action }) => {
      setMessage({
        tone: "info",
        text:
          action === "approve"
            ? question.supersedesId
              ? "Revision approved. The old version is retired."
              : "Question approved."
            : action === "discard"
              ? "Draft discarded."
              : "Question retired.",
      });
      void queryClient.invalidateQueries({ queryKey: questionsPrefix });
    },
    onError: (error) => setMessage({ tone: "danger", text: errorText(error, "That didn't work. Try again.") }),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  function confirm(question: QuestionDto, action: QuestionAction): void {
    const run = () => act.mutate({ question, action });
    if (action === "approve") {
      Alert.alert(
        "Approve this question?",
        question.supersedesId
          ? "It replaces the approved version, which is then retired. Check the wording and the answer first."
          : "Once approved it can be used in a paper. Check the wording and the answer first.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Approve", onPress: run },
        ],
      );
    } else if (action === "discard") {
      Alert.alert("Discard this draft?", "It will be deleted.", [
        { text: "Cancel", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: run },
      ]);
    } else {
      Alert.alert(
        "Retire this question?",
        "It stays on record but can no longer be used in a new paper.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Retire", style: "destructive", onPress: run },
        ],
      );
    }
  }

  function openEditor(question: QuestionDto | null): void {
    if (!pair) return;
    router.push({
      pathname: "/staff/question-bank/edit",
      params: question
        ? { id: question.id, levelId: pair.levelId, subjectId: pair.subjectId }
        : { levelId: pair.levelId, subjectId: pair.subjectId },
    });
  }

  const all = list.data ?? [];
  const drafts = retiredTab ? [] : all.filter((q) => q.status === "DRAFT");
  const approved = retiredTab ? [] : all.filter((q) => q.status === "APPROVED");
  const shown = tab === "DRAFT" ? drafts : tab === "APPROVED" ? approved : all;
  const tabOptions = (Object.keys(TAB_LABELS) as Tab[]).map((t) => ({
    value: t,
    label:
      t === "RETIRED" || retiredTab || !list.data
        ? TAB_LABELS[t]
        : `${TAB_LABELS[t]} (${t === "DRAFT" ? drafts.length : approved.length})`,
  }));

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching || scope.isRefetching}
            onRefresh={() => void (pair ? list.refetch() : scope.refetch())}
            tintColor={colors.primary}
          />
        }
      >
        <ScreenHeader
          title="Question bank"
          subtitle="Your school's own exam questions. Draft them with AI or write them yourself — each one is approved by the subject teacher or an admin before it can go in a paper."
        />

        {!canRead ? (
          <Notice tone="info">Your role can&apos;t open the question bank. Ask your school administrator if you need it.</Notice>
        ) : scope.isPending ? (
          <Skeleton lines={3} />
        ) : scope.isError ? (
          <LoadError error={scope.error} what="your subjects" onRetry={() => void scope.refetch()} />
        ) : scope.data.levels.length === 0 || scope.data.subjects.length === 0 ? (
          <Notice tone="info">
            {scope.data.all
              ? "There are no active class levels or subjects yet. Set them up under Academics first."
              : "You aren't assigned to teach any subject yet, so there is no question bank to show. Ask an admin to assign you."}
          </Notice>
        ) : (
          <>
            <Card>
              <ChoiceChips
                label="Class"
                options={scope.data.levels.map((l) => ({ value: l.id, label: l.name }))}
                value={levelId}
                onChange={(next) => {
                  setLevelId(next);
                  // A subject chosen for the previous level may not be taught at this one.
                  setSubjectId(null);
                  setMessage(null);
                }}
              />
              {levelId !== null &&
                (subjectChoices.length === 0 ? (
                  <Caption>You don&apos;t teach a subject at this level.</Caption>
                ) : (
                  <ChoiceChips
                    label="Subject"
                    options={subjectChoices.map((s) => ({ value: s.id, label: s.name }))}
                    value={subjectId}
                    onChange={(next) => {
                      setSubjectId(next);
                      setMessage(null);
                    }}
                  />
                ))}
            </Card>

            {pair && (
              <>
                {(canWrite || canGenerate) && (
                  <Card>
                    <Heading>{`${pair.levelName} ${pair.subjectName}`}</Heading>
                    {canGenerate && (
                      <View style={styles.block}>
                        <Button
                          title="Draft questions with AI"
                          onPress={() =>
                            router.push({
                              pathname: "/staff/question-bank/generate",
                              params: {
                                levelId: pair.levelId,
                                levelName: pair.levelName,
                                subjectId: pair.subjectId,
                                subjectName: pair.subjectName,
                              },
                            })
                          }
                        />
                        <Caption>
                          Uses your school&apos;s AI budget. Every question it writes arrives as a draft, and nothing is used
                          until a teacher or admin approves it.
                        </Caption>
                      </View>
                    )}
                    {canWrite && <Button title="Write a question" variant="secondary" onPress={() => openEditor(null)} />}
                  </Card>
                )}

                <ChoiceChips label="Show" options={tabOptions} value={tab} onChange={setTab} />
                <TextField
                  label="Search"
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search topic or question"
                  maxLength={100}
                />

                {message && <Notice tone={message.tone}>{message.text}</Notice>}

                <SectionHeader title={TAB_LABELS[tab]} />
                {list.isPending ? (
                  <Skeleton lines={4} />
                ) : list.isError ? (
                  <LoadError error={list.error} what="the questions" onRetry={() => void list.refetch()} />
                ) : shown.length === 0 ? (
                  <EmptyState
                    icon="help-circle-outline"
                    title={query ? "No questions match" : "Nothing here"}
                    body={
                      query
                        ? "Nothing matches that search. Try another word."
                        : tab === "DRAFT"
                          ? "No drafts waiting. Draft some with AI above, or write one."
                          : tab === "APPROVED"
                            ? "No approved questions yet. Approve drafts to build the bank."
                            : "No retired questions."
                    }
                  />
                ) : (
                  shown.map((q) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      busy={act.isPending && act.variables?.question.id === q.id ? act.variables.action : null}
                      disabled={act.isPending}
                      canWrite={canWrite}
                      canApprove={canApprove}
                      onEdit={() => openEditor(q)}
                      onAction={(action) => confirm(q, action)}
                    />
                  ))
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * One question, with the actions its status allows and the caller may take.
 * An AI draft is tinted AND says so in words, so a reviewer can never mistake
 * it for a question a colleague wrote and checked. No accent borders: a tint
 * and a word (CLAUDE.md).
 */
function QuestionCard({
  question: q,
  busy,
  disabled,
  canWrite,
  canApprove,
  onEdit,
  onAction,
}: {
  question: QuestionDto;
  busy: QuestionAction | null;
  disabled: boolean;
  canWrite: boolean;
  canApprove: boolean;
  onEdit: () => void;
  onAction: (action: QuestionAction) => void;
}) {
  const { colors } = useTheme();
  const [showGuide, setShowGuide] = useState(false);
  const isAiDraft = q.status === "DRAFT" && q.source === "AI";

  const meta = [
    QUESTION_TYPE_LABELS[q.type],
    DIFFICULTY[q.difficulty],
    `${q.marks} mark${q.marks === 1 ? "" : "s"}`,
    q.topic,
  ].join(" · ");

  return (
    <Card style={isAiDraft ? { backgroundColor: `${colors.secondary}24` } : undefined}>
      <Caption>{meta}</Caption>
      {isAiDraft && <Text style={[styles.flag, { color: colors.foreground }]}>AI draft — check before approving</Text>}
      {q.status === "APPROVED" && (
        <Text style={[styles.flag, { color: colors.primary }]}>
          {`Approved${q.approvedByName ? ` by ${q.approvedByName}` : ""}`}
        </Text>
      )}
      {q.status === "RETIRED" && <Label>Retired</Label>}
      {Boolean(q.supersedesId) && q.status === "DRAFT" && (
        <Text style={[styles.flag, { color: colors.foreground }]}>Revision of an approved question</Text>
      )}

      <Body>{q.text}</Body>

      {q.type === "MULTIPLE_CHOICE" && (
        <View style={styles.options}>
          {q.options.map((o, i) => (
            <View
              key={o.id}
              style={[styles.option, o.isCorrect && { backgroundColor: `${colors.primary}1F` }]}
            >
              <Text style={[styles.letter, { color: colors.foreground }]}>{OPTION_LETTERS[i]}</Text>
              <Text style={[styles.optionText, { color: colors.foreground }]}>{o.text}</Text>
              {o.isCorrect && <Text style={[styles.correct, { color: colors.primary }]}>Correct</Text>}
            </View>
          ))}
        </View>
      )}

      {q.answerGuide ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showGuide }}
            onPress={() => setShowGuide((v) => !v)}
            style={styles.toggle}
          >
            <Text style={[styles.toggleText, { color: colors.primary }]}>
              {`${showGuide ? "Hide" : "Show"} ${q.type === "MULTIPLE_CHOICE" ? "why it is right" : "marking guide"}`}
            </Text>
          </Pressable>
          {showGuide && <Body>{q.answerGuide}</Body>}
        </>
      ) : null}

      {q.status === "APPROVED" && Boolean(q.openRevisionId) && (
        <Notice tone="warning">
          A revised draft of this question is waiting for approval. This version stays in use until then.
        </Notice>
      )}

      {q.status === "DRAFT" && (
        <View style={styles.actions}>
          {canApprove && (
            <Button title="Approve" loading={busy === "approve"} disabled={disabled} onPress={() => onAction("approve")} />
          )}
          {canWrite && <Button title="Edit" variant="secondary" disabled={disabled} onPress={onEdit} />}
          {canWrite && (
            <Button
              title="Discard"
              variant="secondary"
              loading={busy === "discard"}
              disabled={disabled}
              onPress={() => onAction("discard")}
            />
          )}
        </View>
      )}
      {q.status === "APPROVED" && (
        <View style={styles.actions}>
          {canWrite && (
            <Button
              title="Revise"
              variant="secondary"
              disabled={disabled || Boolean(q.openRevisionId)}
              onPress={onEdit}
            />
          )}
          {canWrite && q.openRevisionId ? <Caption>A revision is already waiting — edit that draft.</Caption> : null}
          {canApprove && (
            <Button
              title="Retire"
              variant="secondary"
              loading={busy === "retire"}
              disabled={disabled}
              onPress={() => onAction("retire")}
            />
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
  block: { gap: spacing.xs },
  flag: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption },
  options: { gap: spacing.xs },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  letter: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body, width: 16 },
  optionText: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: fontSizes.body },
  correct: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption },
  toggle: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  toggleText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  actions: { gap: spacing.sm },
});
