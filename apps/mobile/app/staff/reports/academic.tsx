import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { formatHundredths } from "@school-kit/types";

import { LoadError } from "../../../src/components/load-error";
import { openOnWebsite, useAnalyticsAccess, websiteAvailable } from "../../../src/components/report-access";
import { ReportShare } from "../../../src/components/report-share";
import { staffAcademicReport } from "../../../src/lib/api/staff-reports";
import { queryKeys } from "../../../src/lib/query/keys";
import { changeSince, count, pct } from "../../../src/lib/staff/report-copy";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, CenteredMessage, Screen } from "../../../src/components/ui";
import { EmptyState, ListRow, ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";

// Phase 9 / CP1.3b — academic results on the phone (docs/modules/phase-9.md §8.3).
// Released report cards only, as on the website. The subject × class heatmap
// does not fit a phone, so this shows each class's average and its top and
// bottom students, and links to the website for the chart.

export default function AcademicReportScreen() {
  const { status, authed, schoolId, userId, allowed, ready } = useAnalyticsAccess();
  const report = useQuery({
    queryKey: queryKeys.staffAcademicReport(schoolId, userId),
    queryFn: () => staffAcademicReport(),
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
          title="Academic results"
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

        {data && data.classes.length === 0 ? (
          <EmptyState
            icon="ribbon-outline"
            title="No results released yet"
            body="A class appears here once its report cards are released."
          />
        ) : null}

        {data && data.classes.length > 0 ? (
          <>
            <Body muted>Averages from released report cards only.</Body>
            <ReportShare
              report="academic"
              termName={data.term?.name ?? null}
              yearLabel={data.term?.academicYearLabel ?? null}
            />
            <SectionHeader title="Class averages" note={`${data.classes.length}`} />
            {data.classes.map((c) => (
              <ListRow
                key={c.groupId}
                icon="school-outline"
                title={`${c.label} · ${pct(c.averageHundredths)}`}
                subtitle={[count(c.releasedCount, "student", "students"), changeSince(c.changeHundredths)].filter(Boolean).join(" · ")}
              />
            ))}

            <SectionHeader title="Top and bottom students" />
            {data.rankings.map((r) => (
              <Card key={r.groupId} style={styles.band}>
                <Body>{r.label}</Body>
                <Body muted>Top</Body>
                {r.top.map((s, i) => (
                  <Body key={s.studentId}>{`${i + 1}. ${s.name} — ${formatHundredths(s.averageHundredths)}`}</Body>
                ))}
                {r.bottom.length > 0 ? <Body muted>Bottom (lowest first)</Body> : null}
                {r.bottom.map((s, i) => (
                  <Body key={s.studentId}>{`${i + 1}. ${s.name} — ${formatHundredths(s.averageHundredths)}`}</Body>
                ))}
              </Card>
            ))}

            {websiteAvailable() ? (
              <Button
                title="Subject chart on the website"
                variant="secondary"
                onPress={() => openOnWebsite("/reports/academic")}
              />
            ) : (
              <Body muted>The subject-by-class chart is on the SchoolKit website.</Body>
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  band: { gap: spacing.xs },
});
