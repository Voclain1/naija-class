import { useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CbtCandidateRowDto } from "@school-kit/types";

import { LoadError } from "../../../../src/components/load-error";
import {
  staffCbtCandidates,
  staffCbtSitting,
  staffCloseCbtSitting,
  staffDeleteCbtSitting,
  staffPublishCbtSitting,
  staffUnpublishCbtSitting,
} from "../../../../src/lib/api/staff-cbt";
import { ApiError, ApiNetworkError } from "../../../../src/lib/api/client";
import { queryKeys } from "../../../../src/lib/query/keys";
import { useSession } from "../../../../src/lib/auth/session";
import { hasPermission } from "../../../../src/lib/auth/permissions";
import {
  cbtProgressLabel,
  cbtStatusLabel,
  cbtVersionsLabel,
  describeSittingTime,
  plural,
} from "../../../../src/lib/staff/cbt-format";
import { useTheme } from "../../../../src/theme/theme-provider";
import { spacing } from "../../../../src/theme/tokens";
import { Body, Button, Caption, Card, Notice, Screen } from "../../../../src/components/ui";
import { ScreenHeader, SectionHeader, Skeleton, StatRow } from "../../../../src/components/layout";

// One online exam (docs/modules/cbt.md) — the website's /teacher/cbt/[id].
// Publishing freezes the student list and builds the encrypted exam pack (D2,
// D3); the codes are then on the invigilator sheet. Every action is the
// server's to allow (cbt.manage, teacher scope); this screen only offers them
// to staff who hold cbt.manage, and asks first, in the website's words.

type Action = "publish" | "unpublish" | "close" | "delete";

function describeFailure(error: unknown): string {
  if (error instanceof ApiNetworkError) return "Your phone couldn't reach the server. Nothing changed. Try again when you have signal.";
  if (error instanceof ApiError) return error.message || "That didn't work. Try again.";
  return "That didn't work. Try again.";
}

const DONE: Record<Action, string> = {
  publish: "Published. Print the invigilator sheet for the codes.",
  unpublish: "Back to draft.",
  close: "Closed.",
  delete: "Deleted.",
};

export default function OnlineExamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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

  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const sittingKey = queryKeys.staffCbtExam(schoolId, userId, sittingId);
  const sitting = useQuery({
    queryKey: sittingKey,
    queryFn: () => staffCbtSitting(sittingId),
    enabled: ready,
    staleTime: 15_000,
  });
  const candidates = useQuery({
    queryKey: [...sittingKey, "candidates"] as const,
    queryFn: () => staffCbtCandidates(sittingId),
    enabled: ready,
    staleTime: 15_000,
  });

  const act = useMutation({
    mutationFn: async (action: Action): Promise<unknown> => {
      switch (action) {
        case "publish":
          return staffPublishCbtSitting(sittingId);
        case "unpublish":
          return staffUnpublishCbtSitting(sittingId);
        case "close":
          return staffCloseCbtSitting(sittingId);
        case "delete":
          return staffDeleteCbtSitting(sittingId);
      }
    },
    onMutate: () => {
      setNotice(null);
      setFailure(null);
    },
    onSuccess: async (_result, action) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.staffCbtExams(schoolId, userId) });
      if (action === "delete") {
        queryClient.removeQueries({ queryKey: sittingKey });
        if (router.canGoBack()) router.back();
        else router.replace("/staff/online-exams");
        return;
      }
      setNotice(DONE[action]);
      await queryClient.invalidateQueries({ queryKey: sittingKey });
      await queryClient.invalidateQueries({ queryKey: queryKeys.staffCbtResults(schoolId, userId, sittingId) });
    },
    onError: (error) => setFailure(describeFailure(error)),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (!canRead) {
    return (
      <Screen>
        {header}
        <ScreenHeader title="Online exam" />
        <Notice tone="info">Online exams are for teachers and administrators.</Notice>
      </Screen>
    );
  }

  if (sitting.isPending) {
    return (
      <Screen>
        {header}
        <Skeleton lines={5} />
      </Screen>
    );
  }

  if (sitting.isError || !sitting.data) {
    return (
      <Screen>
        {header}
        <ScreenHeader title="Online exam" />
        <LoadError
          error={sitting.error}
          what="this online exam"
          notFound="This online exam is no longer there, or it is not one of yours."
          onRetry={() => void sitting.refetch()}
        />
      </Screen>
    );
  }

  const s = sitting.data;
  const started = new Date(s.startsAt).getTime() <= Date.now();
  const busy = act.isPending;

  function confirm(action: Action, heading: string, text: string, verb: string, destructive = false): void {
    Alert.alert(heading, text, [
      { text: "Cancel", style: "cancel" },
      { text: verb, style: destructive ? "destructive" : "default", onPress: () => act.mutate(action) },
    ]);
  }

  return (
    <Screen>
      {header}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={sitting.isRefetching || candidates.isRefetching}
            onRefresh={() => {
              void sitting.refetch();
              void candidates.refetch();
            }}
            tintColor={colors.primary}
          />
        }
      >
        <ScreenHeader title={s.title} subtitle={`${s.classLevelName} ${s.subjectName} · ${s.termName} · ${s.armNames.join(", ")}`} />
        <Body>
          {cbtStatusLabel(s.status)} · {describeSittingTime(s)}
        </Body>

        {notice ? <Notice tone="info">{notice}</Notice> : null}
        {failure ? <Notice tone="danger">{failure}</Notice> : null}

        <Card style={styles.card}>
          <StatRow
            icon="desktop-outline"
            value={`Online: ${plural(s.objectiveQuestionCount, "question")} · ${s.objectiveTotal} marks`}
            label="Multiple choice, marked automatically"
          />
          <StatRow
            icon="document-text-outline"
            value={
              s.onPaperQuestionCount === 0
                ? "On paper: nothing"
                : `On paper: ${plural(s.onPaperQuestionCount, "question")} · ${s.onPaperTotal} marks`
            }
            label="Marked by the teacher"
          />
          <StatRow
            icon="people-outline"
            value={`Students: ${s.candidateCount}`}
            label={s.status === "DRAFT" ? "Enrolled now; fixed when you publish" : cbtVersionsLabel(s.versionCount)}
          />
        </Card>

        {s.status === "DRAFT" && s.candidateCount === 0 ? (
          <Notice tone="warning">No students are enrolled in the chosen classes this term, so there is nobody to sit it yet.</Notice>
        ) : null}

        <View style={styles.actions}>
          {s.status !== "DRAFT" ? (
            <Button title="Results" onPress={() => router.push(`/staff/online-exams/${sittingId}/results`)} />
          ) : null}
          {s.status !== "DRAFT" && canManage ? (
            <Button
              title="Invigilator sheet"
              variant="secondary"
              onPress={() => router.push(`/staff/online-exams/${sittingId}/invigilator`)}
            />
          ) : null}
          {canManage && s.status === "DRAFT" ? (
            <>
              <Button
                title="Publish"
                loading={busy && act.variables === "publish"}
                disabled={busy || s.candidateCount === 0}
                onPress={() =>
                  confirm(
                    "publish",
                    "Publish this exam?",
                    `Publish "${s.title}"? The student list is fixed and the exam pack is built for the lab computers.`,
                    "Publish",
                  )
                }
              />
              <Button
                title="Delete"
                variant="secondary"
                loading={busy && act.variables === "delete"}
                disabled={busy}
                onPress={() => confirm("delete", "Delete this exam?", `Delete "${s.title}"?`, "Delete", true)}
              />
            </>
          ) : null}
          {canManage && s.status === "PUBLISHED" && !started ? (
            <Button
              title="Back to draft"
              variant="secondary"
              loading={busy && act.variables === "unpublish"}
              disabled={busy}
              onPress={() =>
                confirm(
                  "unpublish",
                  "Take this exam back to draft?",
                  "Lab computers that already downloaded it will need to download it again.",
                  "Back to draft",
                )
              }
            />
          ) : null}
          {canManage && s.status === "PUBLISHED" ? (
            <Button
              title="Close exam"
              variant="secondary"
              loading={busy && act.variables === "close"}
              disabled={busy}
              onPress={() =>
                confirm(
                  "close",
                  "Close this exam?",
                  "Lab computers can no longer download it. Answers still waiting on a computer are kept, and show as arriving after the close.",
                  "Close exam",
                  true,
                )
              }
            />
          ) : null}
        </View>

        <SectionHeader title="Students" note={candidates.data ? String(candidates.data.length) : null} />
        {s.status !== "DRAFT" ? (
          <Caption>
            Progress is what the lab computers have sent so far. A computer without internet sends its answers when it
            reconnects. Pull down to refresh.
          </Caption>
        ) : null}
        {candidates.isPending ? (
          <Skeleton lines={4} />
        ) : candidates.isError ? (
          <LoadError error={candidates.error} what="the students for this exam" onRetry={() => void candidates.refetch()} />
        ) : (candidates.data?.length ?? 0) === 0 ? (
          <Body muted>No students.</Body>
        ) : (
          candidates.data!.map((c) => (
            <CandidateRow key={c.studentId} candidate={c} draft={s.status === "DRAFT"} questionCount={s.objectiveQuestionCount} />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function CandidateRow({
  candidate: c,
  draft,
  questionCount,
}: {
  candidate: CbtCandidateRowDto;
  draft: boolean;
  questionCount: number;
}) {
  return (
    <Card style={styles.row}>
      <Body>
        {c.lastName}, {c.firstName}
      </Body>
      <Caption>
        {c.admissionNumber} · {c.armName} · Version {c.version}
      </Caption>
      {draft ? null : <Body muted={!c.progress}>{cbtProgressLabel(c.progress, questionCount)}</Body>}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  card: { gap: spacing.sm },
  actions: { gap: spacing.sm },
  row: { gap: spacing.xs, minWidth: 0 },
});
