import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { LoadError } from "../../../src/components/load-error";
import { useAnalyticsAccess } from "../../../src/components/report-access";
import { ReportShare } from "../../../src/components/report-share";
import { staffAttendanceReport } from "../../../src/lib/api/staff-reports";
import { queryKeys } from "../../../src/lib/query/keys";
import { count, pct } from "../../../src/lib/staff/report-copy";
import { spacing } from "../../../src/theme/tokens";
import { Body, CenteredMessage, Screen } from "../../../src/components/ui";
import { EmptyState, ListRow, ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";

// Phase 9 / CP1.3b — attendance on the phone (docs/modules/phase-9.md §8.3).
// Each class's rate this term and its latest week, the students below the
// school's often-absent line, and the classes with registers missing. The
// week-by-week grid stays on the website and in the shared files.

const SHOW = 15;

export default function AttendanceReportScreen() {
  const { status, authed, schoolId, userId, allowed, ready } = useAnalyticsAccess();
  const report = useQuery({
    queryKey: queryKeys.staffAttendanceReport(schoolId, userId),
    queryFn: () => staffAttendanceReport(),
    enabled: ready,
    staleTime: 60_000,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const data = report.data;
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          title="Attendance"
          subtitle={data?.term ? `${data.term.name} · ${data.term.academicYearLabel}` : null}
        />
        {!allowed ? (
          <EmptyState icon="lock-closed-outline" title="Not available on your account" body="School reports are for owners and administrators." />
        ) : null}
        {allowed && report.isPending ? <Skeleton lines={6} /> : null}
        {report.isError && !data ? (
          <CenteredMessage>
            <LoadError error={report.error} what="the report" onRetry={() => void report.refetch()} />
          </CenteredMessage>
        ) : null}

        {data && data.term ? (
          <>
            <Body muted>Present or late, out of the days each student was marked.</Body>
            <ReportShare report="attendance" termName={data.term.name} yearLabel={data.term.academicYearLabel} />

            <SectionHeader title="By class" note={`${data.classes.length}`} />
            {data.classes.length === 0 ? <Body muted>No class has students enrolled in this term.</Body> : null}
            {data.classes.map((c) => {
              const latest = [...c.weeks].reverse().find((w) => w.rateHundredths !== null) ?? null;
              return (
                <ListRow
                  key={c.groupId}
                  icon="clipboard-outline"
                  title={`${c.label} · ${pct(c.termRateHundredths)}`}
                  subtitle={latest ? `Latest week ${pct(latest.rateHundredths)}` : "No registers marked yet"}
                />
              );
            })}

            <SectionHeader title={`Often absent — below ${data.thresholdPercent}%`} note={`${data.chronicAbsence.length}`} />
            {data.chronicAbsence.length === 0 ? (
              <Body muted>No student is below {data.thresholdPercent}% this term.</Body>
            ) : null}
            {data.chronicAbsence.slice(0, SHOW).map((s) => (
              <ListRow
                key={s.studentId}
                icon="person-outline"
                title={`${s.name} · ${pct(s.rateHundredths)}`}
                subtitle={`${s.classLabel} · ${count(s.daysAbsent, "day", "days")} absent of ${s.daysMarked}`}
              />
            ))}
            {data.chronicAbsence.length > SHOW ? (
              <Body muted>And {data.chronicAbsence.length - SHOW} more — share the report for the full list.</Body>
            ) : null}

            <SectionHeader title="Days with no register" note={`${data.missingRegisters.length}`} />
            {data.missingRegisters.length === 0 ? (
              <Body muted>Every class has a register for every school day so far.</Body>
            ) : null}
            {data.missingRegisters.map((m) => (
              <ListRow
                key={m.groupId}
                icon="alert-circle-outline"
                title={m.label}
                subtitle={`${count(m.dates.length, "school day", "school days")} with no register`}
              />
            ))}
          </>
        ) : null}
        {data && !data.term ? (
          <EmptyState icon="calendar-outline" title="No current term" body="Set a current term on the website to see this report." />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
});
