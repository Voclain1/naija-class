import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { LoadError } from "../../../src/components/load-error";
import { useAnalyticsAccess } from "../../../src/components/report-access";
import { ReportShare } from "../../../src/components/report-share";
import { staffEnrolmentReport } from "../../../src/lib/api/staff-reports";
import { queryKeys } from "../../../src/lib/query/keys";
import { count } from "../../../src/lib/staff/report-copy";
import { spacing } from "../../../src/theme/tokens";
import { Body, Card, CenteredMessage, Screen } from "../../../src/components/ui";
import { EmptyState, ListRow, ScreenHeader, SectionHeader, Skeleton, StatRow } from "../../../src/components/layout";

// Phase 9 / CP1.3b — enrolment on the phone (docs/modules/phase-9.md §8.3):
// students on roll per level against last term, and who joined or left.

const SHOW = 15;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export default function EnrolmentReportScreen() {
  const { status, authed, schoolId, userId, allowed, ready } = useAnalyticsAccess();
  const report = useQuery({
    queryKey: queryKeys.staffEnrolmentReport(schoolId, userId),
    queryFn: () => staffEnrolmentReport(),
    enabled: ready,
    staleTime: 60_000,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const data = report.data;
  const prev = data?.totals.previousTerm ?? null;
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          title="Enrolment"
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
            <ReportShare report="enrolment" termName={data.term.name} yearLabel={data.term.academicYearLabel} />
            <Card style={styles.band}>
              <StatRow
                icon="people-outline"
                value={count(data.totals.thisTerm, "student on roll", "students on roll")}
                label={prev === null ? "No earlier term to compare with" : `${signed(data.totals.thisTerm - prev)} since last term (${prev})`}
              />
            </Card>

            <SectionHeader title="By level" note={`${data.levels.length}`} />
            {data.levels.map((l) => (
              <ListRow
                key={l.groupId}
                icon="layers-outline"
                title={`${l.label} · ${l.thisTerm}`}
                subtitle={l.previousTerm === null ? null : `${l.previousTerm} last term (${signed(l.thisTerm - l.previousTerm)})`}
              />
            ))}

            {data.previousTerm ? (
              <>
                <SectionHeader title="Joined this term" note={`${data.joiners.length}`} />
                {data.joiners.length === 0 ? <Body muted>No one joined this term.</Body> : null}
                {data.joiners.slice(0, SHOW).map((m) => (
                  <ListRow key={m.studentId} icon="person-add-outline" title={m.name} subtitle={m.classLabel} />
                ))}
                {data.joiners.length > SHOW ? <Body muted>And {data.joiners.length - SHOW} more.</Body> : null}

                <SectionHeader title="Left since last term" note={`${data.leavers.length}`} />
                {data.leavers.length === 0 ? <Body muted>No one left since last term.</Body> : null}
                {data.leavers.slice(0, SHOW).map((m) => (
                  <ListRow key={m.studentId} icon="person-remove-outline" title={m.name} subtitle={`${m.classLabel} · ${m.reason}`} />
                ))}
                {data.leavers.length > SHOW ? <Body muted>And {data.leavers.length - SHOW} more.</Body> : null}
              </>
            ) : (
              <Body muted>Students who joined or left will show here from the school&apos;s second term in SchoolKit.</Body>
            )}
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
  band: { gap: spacing.xs },
});
