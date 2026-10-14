import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CbtSchedulablePaperDto } from "@school-kit/types";

import { LoadError } from "../../../src/components/load-error";
import { staffCbtPapers, staffCbtSittings, staffCreateCbtSitting } from "../../../src/lib/api/staff-cbt";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { isoDateFromParts } from "../../../src/lib/staff/student-form";
import { cbtStatusLabel, describeSittingTime, plural, readScheduleTimes } from "../../../src/lib/staff/cbt-format";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import { Button, Caption, Card, Heading, Label, Notice, Screen } from "../../../src/components/ui";
import { EmptyState, ListRow, ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";
import { DateBoxes, TextField, type DateBoxValues } from "../../../src/components/form";

// Online exams on the phone (docs/modules/cbt.md) — the website's /teacher/cbt:
// the school's sittings, and a form to schedule one from a FINAL exam paper.
// Only the multiple-choice questions are sat online; theory stays on paper
// (decision Q2). Times are typed (this app has no time picker) and read in the
// phone's own time zone, as the website reads them in the computer's.

function describeFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiNetworkError) return "Your phone couldn't reach the server. Nothing changed. Try again when you have signal.";
  if (error instanceof ApiError) return error.message || fallback;
  return fallback;
}

const EMPTY_DATE: DateBoxValues = { day: "", month: "", year: "" };

export default function OnlineExamsScreen() {
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
  const ready = authed && canRead && schoolId !== "" && userId !== "";

  const [paperId, setPaperId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [armIds, setArmIds] = useState<string[]>([]);
  const [date, setDate] = useState<DateBoxValues>(EMPTY_DATE);
  const [startTime, setStartTime] = useState("09:00");
  const [latestStart, setLatestStart] = useState("09:30");
  const [duration, setDuration] = useState("40");
  const [showProblem, setShowProblem] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const sittingsKey = queryKeys.staffCbtExams(schoolId, userId);
  const sittings = useQuery({
    queryKey: sittingsKey,
    queryFn: staffCbtSittings,
    enabled: ready,
    staleTime: 30_000,
  });
  // Under the sittings key, so it stays staff-prefixed (never persisted) and
  // cannot collide with the exam-papers screen's own list.
  const papers = useQuery({
    queryKey: [...sittingsKey, "schedulable-papers"] as const,
    queryFn: staffCbtPapers,
    enabled: ready && canManage,
    staleTime: 60_000,
  });

  const paper = useMemo<CbtSchedulablePaperDto | null>(
    () => papers.data?.find((p) => p.id === paperId) ?? null,
    [papers.data, paperId],
  );

  const isoDate = isoDateFromParts(date.day, date.month, date.year);
  const times = readScheduleTimes({ date: isoDate, startTime, latestStart, duration });
  const titleProblem = paper && !title.trim() ? "Give the exam a title." : null;
  const armsProblem = paper && armIds.length === 0 ? "Choose at least one class." : null;
  const problem = titleProblem ?? armsProblem ?? times.problem;

  const create = useMutation({
    mutationFn: () =>
      staffCreateCbtSitting({
        paperId: paper!.id,
        title: title.trim(),
        classArmIds: armIds,
        startsAt: times.startsAt!.toISOString(),
        windowEndsAt: times.windowEndsAt!.toISOString(),
        durationMinutes: times.durationMinutes!,
      }),
    onMutate: () => setFailure(null),
    onSuccess: async (created) => {
      setPaperId(null);
      setTitle("");
      setArmIds([]);
      setDate(EMPTY_DATE);
      setShowProblem(false);
      await queryClient.invalidateQueries({ queryKey: sittingsKey });
      router.push(`/staff/online-exams/${created.id}`);
    },
    onError: (error) => setFailure(describeFailure(error, "Could not schedule the exam. Try again.")),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  if (!canRead) {
    return (
      <Screen>
        <ScreenHeader title="Online exams" />
        <Notice tone="info">Online exams are for teachers and administrators. Ask your school administrator if you need them.</Notice>
      </Screen>
    );
  }

  function choosePaper(p: CbtSchedulablePaperDto): void {
    setPaperId(p.id);
    setTitle(p.title);
    setArmIds(p.arms.map((a) => a.id));
    setDuration(String(Math.min(p.durationMinutes, 600)));
    setShowProblem(false);
    setFailure(null);
  }

  function toggleArm(id: string): void {
    setArmIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function onSchedule(): void {
    if (problem) {
      setShowProblem(true);
      return;
    }
    create.mutate();
  }

  function onRefresh(): void {
    void sittings.refetch();
    if (canManage) void papers.refetch();
  }

  const scheduleCard = !canManage ? null : papers.isPending ? (
    <Skeleton lines={3} />
  ) : papers.isError ? (
    <LoadError error={papers.error} what="the exam papers you can schedule" onRetry={() => void papers.refetch()} />
  ) : (papers.data?.length ?? 0) === 0 ? (
    <Notice tone="info">
      To schedule an online exam, first finalise an exam paper with multiple-choice questions under Exam papers.
    </Notice>
  ) : (
    <Card style={styles.card}>
      <Heading>Schedule an online exam</Heading>
      <Label>Exam paper</Label>
      {papers.data!.map((p) => {
        const chosen = p.id === paperId;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: chosen }}
            accessibilityLabel={`${p.title}, ${p.classLevelName} ${p.subjectName}, ${p.termName}`}
            onPress={() => choosePaper(p)}
            style={[
              styles.option,
              { borderColor: chosen ? colors.primary : colors.border, backgroundColor: chosen ? colors.primary + "1A" : "transparent" },
            ]}
          >
            <Text style={[styles.optionTitle, { color: colors.foreground }]}>{p.title}</Text>
            <Caption>
              {p.classLevelName} {p.subjectName}, {p.termName}
              {chosen ? " · Chosen" : ""}
            </Caption>
          </Pressable>
        );
      })}
      {paper ? (
        <>
          <Caption>
            {plural(paper.objectiveQuestionCount, "multiple-choice question")} ({paper.objectiveTotal} marks) will be sat online.
            {paper.onPaperQuestionCount === 1
              ? " 1 other question stays on paper."
              : paper.onPaperQuestionCount > 1
                ? ` ${paper.onPaperQuestionCount} other questions stay on paper.`
                : ""}
          </Caption>
          <TextField label="Title" value={title} onChangeText={setTitle} maxLength={200} autoCapitalize="sentences" />
          <View style={styles.field}>
            <Label>Classes</Label>
            <View style={styles.chips}>
              {paper.arms.map((arm) => {
                const on = armIds.includes(arm.id);
                return (
                  <Pressable
                    key={arm.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={arm.name}
                    onPress={() => toggleArm(arm.id)}
                    style={[styles.chip, { borderColor: colors.primary, backgroundColor: on ? colors.primary : "transparent" }]}
                  >
                    <Text style={[styles.chipText, { color: on ? colors.primaryForeground : colors.primary }]}>
                      {on ? `✓ ${arm.name}` : arm.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <DateBoxes label="Date" value={date} onChange={setDate} />
          <View style={styles.row}>
            <View style={styles.cell}>
              <TextField label="Starts at" value={startTime} onChangeText={setStartTime} placeholder="09:00" maxLength={5} />
            </View>
            <View style={styles.cell}>
              <TextField label="Latest start" value={latestStart} onChangeText={setLatestStart} placeholder="09:30" maxLength={5} />
            </View>
          </View>
          <TextField label="Length (minutes)" value={duration} onChangeText={setDuration} keyboardType="number-pad" maxLength={3} />
          <Caption>
            A student may begin any time between the start and the latest start, and then has the full length. Times are in
            this phone&apos;s time zone.
          </Caption>
          {showProblem && problem ? <Notice tone="danger">{problem}</Notice> : null}
          {failure ? <Notice tone="danger">{failure}</Notice> : null}
          <Button
            title={create.isPending ? "Scheduling…" : "Schedule exam"}
            loading={create.isPending}
            disabled={create.isPending}
            onPress={onSchedule}
          />
        </>
      ) : null}
    </Card>
  );

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={sittings.isRefetching} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          <ScreenHeader
            title="Online exams"
            subtitle="Students sit a final exam paper on the school's computers. The multiple-choice questions are marked automatically; theory questions stay on paper."
          />

          {scheduleCard}

          <SectionHeader title="Scheduled exams" />
          {sittings.isPending ? (
            <Skeleton lines={4} />
          ) : sittings.isError ? (
            <LoadError error={sittings.error} what="online exams" onRetry={() => void sittings.refetch()} />
          ) : (sittings.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="desktop-outline"
              title="No online exams yet"
              body={canManage ? "Exams you schedule appear here." : "Exams your school schedules appear here."}
            />
          ) : (
            sittings.data!.map((s) => (
              <ListRow
                key={s.id}
                icon="desktop-outline"
                title={s.title}
                subtitle={`${s.classLevelName} ${s.subjectName} · ${s.armNames.join(", ")} · ${describeSittingTime(s)} · ${plural(s.candidateCount, "student")}`}
                meta={cbtStatusLabel(s.status)}
                onPress={() => router.push(`/staff/online-exams/${s.id}`)}
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
  card: { gap: spacing.sm },
  field: { gap: spacing.xs },
  option: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: 2,
    minHeight: 44,
    minWidth: 0,
  },
  optionTitle: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: "center",
    maxWidth: "100%",
  },
  chipText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  row: { flexDirection: "row", gap: spacing.sm },
  cell: { flex: 1, minWidth: 0 },
});
