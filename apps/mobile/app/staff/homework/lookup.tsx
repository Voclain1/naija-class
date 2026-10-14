import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { HomeworkDto } from "@school-kit/types";

import { staffHomework } from "../../../src/lib/api/staff-homework";
import { staffClassArms } from "../../../src/lib/api/staff-students";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { serverToday } from "../../../src/lib/staff/server-date";
import { RECENT_DAYS, splitHomeworkForLookup } from "../../../src/lib/staff/homework-lookup";
import { useTheme } from "../../../src/theme/theme-provider";
import { spacing } from "../../../src/theme/tokens";
import { Body, Card, Heading, Label, Notice, Screen } from "../../../src/components/ui";
import { EmptyState, ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";
import { ChoiceChips } from "../../../src/components/form";
import { LoadError } from "../../../src/components/load-error";

// The counter lookup (docs/modules/the-school-day.md Part B): pick a class,
// read what it has been set. A bursar holds homework.read so they can answer a
// parent at the counter, and until the pre-build audit (2026-10-13) no screen
// on either surface used it. Nothing is written here; the menu sends anyone
// who can set homework to the full screen instead.

function when(dueDate: string): string {
  return new Date(`${dueDate}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function HomeworkCard({ item, today }: { item: HomeworkDto; today: string }) {
  return (
    <Card>
      <Heading>{item.title}</Heading>
      <Label>
        {item.subjectName} · {item.dueDate === today ? "due today" : `due ${when(item.dueDate)}`}
        {item.postedByName ? ` · set by ${item.postedByName}` : ""}
      </Label>
      {item.instructions ? <Body>{item.instructions}</Body> : null}
    </Card>
  );
}

export default function HomeworkLookupScreen() {
  const { status, principal, staff } = useSession();
  const { colors } = useTheme();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "";

  const [armId, setArmId] = useState<string | null>(null);

  const arms = useQuery({
    queryKey: queryKeys.staffClassArms(schoolId, userId),
    queryFn: () => staffClassArms(),
    enabled: ready,
    staleTime: 10 * 60_000,
  });

  const list = useQuery({
    queryKey: queryKeys.staffHomework(schoolId, userId, armId ?? ""),
    queryFn: () => staffHomework(armId ?? undefined),
    enabled: ready && armId !== null,
    staleTime: 60_000,
  });

  const today = serverToday() ?? new Date().toISOString().slice(0, 10);
  const lookup = useMemo(() => (list.data ? splitHomeworkForLookup(list.data.data, today) : null), [list.data, today]);
  const sortedArms = useMemo(
    () => [...(arms.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true })),
    [arms.data],
  );

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching}
            onRefresh={() => void (armId ? list.refetch() : arms.refetch())}
            tintColor={colors.primary}
          />
        }
      >
        <ScreenHeader title="Homework" subtitle="What a class has been set, for when a parent asks." />

        {arms.isPending ? (
          <Skeleton lines={2} />
        ) : arms.isError ? (
          <LoadError error={arms.error} what="the school's classes" onRetry={() => void arms.refetch()} />
        ) : sortedArms.length === 0 ? (
          <Notice tone="info">The school has no classes set up yet.</Notice>
        ) : (
          <ChoiceChips
            label="Class"
            options={sortedArms.map((arm) => ({ value: arm.id, label: arm.name }))}
            value={armId}
            onChange={setArmId}
          />
        )}

        {armId !== null &&
          (list.isPending ? (
            <Skeleton lines={4} />
          ) : list.isError ? (
            <LoadError error={list.error} what="this class's homework" onRetry={() => void list.refetch()} />
          ) : lookup ? (
            <>
              <SectionHeader title="Due today and later" />
              {lookup.upcoming.length === 0 ? (
                <EmptyState icon="book-outline" title="Nothing due" body="This class has nothing due." />
              ) : (
                lookup.upcoming.map((item) => <HomeworkCard key={item.id} item={item} today={today} />)
              )}
              <SectionHeader title={`Due in the last ${RECENT_DAYS} days`} />
              {lookup.recent.length === 0 ? (
                <Label>Nothing was due this past week.</Label>
              ) : (
                lookup.recent.map((item) => <HomeworkCard key={item.id} item={item} today={today} />)
              )}
            </>
          ) : null)}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
});
