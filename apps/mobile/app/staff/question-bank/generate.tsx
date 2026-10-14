import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  QUESTION_DIFFICULTIES,
  QUESTION_GENERATE_MAX,
  QUESTION_TOPIC_MAX,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type QuestionDifficulty,
  type QuestionType,
} from "@school-kit/types";

import { generateStaffQuestions } from "../../../src/lib/api/staff-questions";
import { ApiError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { generatedSummary } from "../../../src/lib/staff/question-form";
import { spacing } from "../../../src/theme/tokens";
import { Button, Caption, Card, Heading, Notice, Screen } from "../../../src/components/ui";
import { ScreenHeader } from "../../../src/components/layout";
import { ChoiceChips, TextField } from "../../../src/components/form";

// AI drafting for the question bank (Phase 8c / CP5b) — the "Draft questions
// with AI" panel of apps/web's /teacher/question-bank, as its own screen.
//
// Two things are said before the button, not after: this spends the school's
// AI budget, and everything it writes lands as a DRAFT. The model never
// approves its own work (CLAUDE.md, AI hard rules); the drafts wait in the
// bank's "Drafts to review" list for a person.
//
// Params: `levelId`, `levelName`, `subjectId`, `subjectName` from the bank.

const DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" };

const PROGRESS_LINES = [
  "Reading the topic and class level…",
  "Checking your scheme of work…",
  "Writing the questions…",
  "Writing the answers and marking guides…",
  "Almost there…",
];

const COUNTS = Array.from({ length: QUESTION_GENERATE_MAX }, (_, i) => String(i + 1));

export default function QuestionGenerateScreen() {
  const { status, principal, staff } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ levelId?: string; levelName?: string; subjectId?: string; subjectName?: string }>();
  const levelId = typeof params.levelId === "string" ? params.levelId : "";
  const subjectId = typeof params.subjectId === "string" ? params.subjectId : "";
  const levelName = typeof params.levelName === "string" ? params.levelName : "";
  const subjectName = typeof params.subjectName === "string" ? params.subjectName : "";

  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const canGenerate = hasPermission(staff?.permissions ?? [], "question.generate");

  const [topic, setTopic] = useState("");
  const [type, setType] = useState<QuestionType>("MULTIPLE_CHOICE");
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>("MEDIUM");
  const [count, setCount] = useState("5");
  const [progress, setProgress] = useState(0);

  const generate = useMutation({
    mutationFn: () =>
      generateStaffQuestions({
        classLevelId: levelId,
        subjectId,
        topic: topic.trim(),
        type,
        difficulty,
        count: Number(count),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.staffQuestions(schoolId, userId, "").slice(0, 4) });
    },
  });

  // A minute is long to stare at a spinner; say what is happening.
  const generating = generate.isPending;
  useEffect(() => {
    if (!generating) {
      setProgress(0);
      return;
    }
    const t = setInterval(() => setProgress((i) => Math.min(i + 1, PROGRESS_LINES.length - 1)), 4000);
    return () => clearInterval(t);
  }, [generating]);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;
  const where = levelName && subjectName ? `${levelName} ${subjectName}` : null;

  if (!canGenerate || !levelId || !subjectId) {
    return (
      <Screen>
        {header}
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title="Draft questions with AI" />
          <Notice tone="info">
            {!canGenerate
              ? "Your role can't draft questions with AI. Ask your school administrator if you need to."
              : "Choose a class and subject in the question bank first."}
          </Notice>
        </ScrollView>
      </Screen>
    );
  }

  const error = generate.error;
  const result = generate.data;

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader title="Draft questions with AI" subtitle={where} />

          <Notice tone="warning">
            This uses your school&apos;s AI budget. Every question it writes arrives as a draft: nothing is used in a paper
            until the subject teacher or an admin checks and approves it.
          </Notice>

          <Card>
            <TextField
              label="Topic"
              value={topic}
              onChangeText={setTopic}
              placeholder="e.g. Equations of motion"
              maxLength={QUESTION_TOPIC_MAX}
              autoCapitalize="sentences"
            />
            <ChoiceChips
              label="Type"
              options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABELS[t] }))}
              value={type}
              onChange={setType}
            />
            <ChoiceChips
              label="Difficulty"
              options={QUESTION_DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))}
              value={difficulty}
              onChange={setDifficulty}
            />
            <ChoiceChips
              label="How many"
              options={COUNTS.map((n) => ({ value: n, label: n }))}
              value={count}
              onChange={setCount}
            />
          </Card>

          {error ? (
            <Notice tone="danger">
              {error instanceof ApiError && error.message
                ? error.message
                : "Could not draft questions. Check your connection and try again."}
            </Notice>
          ) : null}

          {result ? (
            <Card>
              <Heading>Drafts ready to review</Heading>
              <Notice tone="info">{generatedSummary(result)}</Notice>
              <Button title="Review the drafts" onPress={() => router.back()} />
            </Card>
          ) : null}

          <Button
            title={generating ? "Drafting…" : "Draft questions"}
            loading={generating}
            disabled={topic.trim().length < 2}
            onPress={() => generate.mutate()}
          />
          <Caption>
            {generating ? PROGRESS_LINES[progress] : "Takes up to a minute. Nothing is used until you approve it."}
          </Caption>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md },
});
