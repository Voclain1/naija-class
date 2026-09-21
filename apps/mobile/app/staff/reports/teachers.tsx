import { useMemo } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { staffTeacherActivity } from "../../../src/lib/api/staff-reports";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { isSchoolAdmin } from "../../../src/lib/auth/roles";
import { percent, teachersByOutstanding } from "../../../src/lib/staff/report-summary";
import { spacing } from "../../../src/theme/tokens";
import { Button, CenteredMessage, Notice, Screen } from "../../../src/components/ui";
import { EmptyState, ListRow, ScreenHeader, Skeleton } from "../../../src/components/layout";

// CP4d — recording activity, by teacher.
//
// D35: every time this view loads, the server writes an audit row. It is a
// per-person view of named colleagues, and a head browsing it should know that
// browsing is itself recorded — so the screen says so, at the top, before the
// names.
//
// For the same reason the query NEVER refetches on its own: not when the app
// returns to the foreground, not when the network comes back. One opening, one
// read, one audit row — never a trail of rows the admin did not cause.

export default function TeacherActivityScreen() {
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const allowed =
    isSchoolAdmin(staff?.roles) &&
    hasPermission(staff?.permissions ?? [], "reports.teacher-activity.read");

  const report = useQuery({
    queryKey: queryKeys.staffTeacherActivity(schoolId, userId),
    queryFn: () => staffTeacherActivity(),
    enabled: authed && allowed && schoolId !== "" && userId !== "",
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: false,
  });

  const rows = useMemo(() => teachersByOutstanding(report.data?.rows ?? []), [report.data]);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  return (
    <Screen>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title="By teacher" subtitle={report.data?.term?.name ?? null} />

        {allowed ? (
          <Notice tone="info">
            Opening this view is recorded in the school&apos;s records, because it shows named
            colleagues&apos; work.
          </Notice>
        ) : (
          <EmptyState
            icon="lock-closed-outline"
            title="Not available on your account"
            body="This view is for owners and administrators."
          />
        )}

        {allowed && report.isPending ? <Skeleton lines={6} /> : null}

        {report.isError && !report.data ? (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load this. Try again shortly.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void report.refetch()} />
          </CenteredMessage>
        ) : null}

        {report.data && rows.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No teachers yet"
            body="Nobody on your staff holds the teacher role this term."
          />
        ) : null}

        {rows.map((row) => {
          const marks = percent(row.assignedSlotsEntered, row.assignedSlotsExpected);
          const registers = percent(row.formArmRegistersTaken, row.formArmRegistersExpected);
          const parts = [
            marks === null ? "no marks due" : `marks ${marks}%`,
            row.formArms.length > 0
              ? registers === null
                ? `${row.formArms.join(", ")} · no registers due`
                : `${row.formArms.join(", ")} registers ${registers}%`
              : null,
          ].filter(Boolean);
          return (
            <ListRow
              key={row.userId}
              icon="person-outline"
              title={row.name}
              subtitle={parts.join(" · ")}
            />
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
});
