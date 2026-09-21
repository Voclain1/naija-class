import { useMemo } from "react";
import { Linking, ScrollView, StyleSheet } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { staffCompleteness } from "../../../src/lib/api/staff-approvals";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { isSchoolAdmin } from "../../../src/lib/auth/roles";
import { laggingRegisters, laggingScores, percent } from "../../../src/lib/staff/report-summary";
import { webUrl } from "../../../src/lib/web-handoff";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, CenteredMessage, Notice, Screen } from "../../../src/components/ui";
import {
  EmptyState,
  ListRow,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  StatRow,
} from "../../../src/components/layout";

// CP4d — "is the school keeping up?", on one screen.
//
// The website's completeness report is a set of long tables. On a phone the
// useful question is only what is BEHIND, so this shows the totals, then the
// classes and subjects that are behind, worst first — and nothing that is fine.
//
// The same request backs the approvals screen, so opening one after the other
// costs nothing (same query key).
//
// Term-health problems (no current term, classes without a form teacher…) are
// fixed in settings, which stay on the website; each one links there.

const SHOW_TOP = 8;

export default function ReportsScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const permissions = staff?.permissions ?? [];
  const allowed = isSchoolAdmin(staff?.roles) && hasPermission(permissions, "reports.completeness.read");
  const canSeeTeachers =
    isSchoolAdmin(staff?.roles) && hasPermission(permissions, "reports.teacher-activity.read");

  const report = useQuery({
    queryKey: queryKeys.staffCompleteness(schoolId, userId, null),
    queryFn: () => staffCompleteness(),
    enabled: authed && allowed && schoolId !== "" && userId !== "",
    staleTime: 30_000,
  });

  const lagging = useMemo(
    () => ({
      registers: laggingRegisters(report.data?.attendance?.rows ?? []),
      scores: laggingScores(report.data?.scores?.rows ?? []),
    }),
    [report.data],
  );

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const data = report.data;
  const attendance = data?.attendance?.totals ?? null;
  const scoreTotals = data?.scores?.totals ?? null;
  const registersPct = attendance ? percent(attendance.registersTaken, attendance.registersExpected) : null;
  const marksPct = scoreTotals ? percent(scoreTotals.slotsEntered, scoreTotals.slotsExpected) : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          title="Reports"
          subtitle={data?.term ? `${data.term.name} · ${data.term.academicYearLabel}` : null}
        />

        {!allowed ? (
          <EmptyState
            icon="lock-closed-outline"
            title="Not available on your account"
            body="School reports are for owners and administrators."
          />
        ) : null}

        {allowed && report.isPending ? <Skeleton lines={5} /> : null}

        {report.isError && !data ? (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load the report. Try again shortly.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void report.refetch()} />
          </CenteredMessage>
        ) : null}

        {(data?.health ?? []).length > 0 ? (
          <>
            <SectionHeader title="Fix these first" />
            <Card style={styles.band}>
              {(data?.health ?? []).map((signal) => {
                const link = webUrl(signal.href);
                return (
                  <StatRow
                    key={signal.code}
                    icon="construct-outline"
                    tone="warning"
                    value={signal.message}
                    label={
                      signal.arms.length > 0
                        ? signal.arms.join(", ")
                        : link
                          ? "Fix on the website"
                          : "Fixed on the website"
                    }
                    onPress={link ? () => void Linking.openURL(link) : undefined}
                  />
                );
              })}
            </Card>
          </>
        ) : null}

        {data && data.term ? (
          <>
            <SectionHeader
              title="This term so far"
              note={data.schoolDays ? `${data.schoolDays.schoolDayCount} school days` : null}
            />
            <Card style={styles.band}>
              <StatRow
                icon="clipboard-outline"
                value={
                  registersPct === null
                    ? "No registers due yet"
                    : `${registersPct}% of registers taken`
                }
                label={
                  attendance
                    ? `${attendance.registersTaken} of ${attendance.registersExpected} class-days`
                    : "Attendance"
                }
              />
              <StatRow
                icon="create-outline"
                value={marksPct === null ? "No marks due yet" : `${marksPct}% of marks entered`}
                label={
                  scoreTotals
                    ? `${scoreTotals.slotsEntered} of ${scoreTotals.slotsExpected} marks`
                    : "Marks"
                }
              />
              {data.reportCards ? (
                <StatRow
                  icon="ribbon-outline"
                  value={`${data.reportCards.totals.byStatus.RELEASED} report cards released`}
                  label={`${data.reportCards.totals.byStatus.PRINCIPAL_APPROVED} approved, waiting to release`}
                  onPress={() => router.push("/staff/approvals")}
                />
              ) : null}
            </Card>
          </>
        ) : null}

        {lagging.registers.length > 0 ? (
          <>
            <SectionHeader title="Registers behind" note={`${lagging.registers.length}`} />
            {lagging.registers.slice(0, SHOW_TOP).map((row) => (
              <ListRow
                key={row.groupId}
                icon="clipboard-outline"
                title={row.label}
                subtitle={`${row.registersTaken} of ${row.registersExpected} taken${
                  row.lastRegisterDate ? ` · last ${row.lastRegisterDate}` : " · none yet"
                }`}
              />
            ))}
          </>
        ) : null}

        {lagging.scores.length > 0 ? (
          <>
            <SectionHeader title="Marks behind" note={`${lagging.scores.length}`} />
            {lagging.scores.slice(0, SHOW_TOP).map((row) => (
              <ListRow
                key={`${row.groupId}-${row.subjectId}`}
                icon="create-outline"
                title={`${row.subjectName} · ${row.label}`}
                subtitle={`${row.slotsEntered} of ${row.slotsExpected} marks entered`}
              />
            ))}
            {lagging.scores.length > SHOW_TOP ? (
              <Body muted>And {lagging.scores.length - SHOW_TOP} more — the full list is on the website.</Body>
            ) : null}
          </>
        ) : null}

        {data && data.term && lagging.registers.length === 0 && lagging.scores.length === 0 ? (
          <EmptyState
            icon="checkmark-circle-outline"
            title="Nothing behind"
            body="Every register due has been taken and every mark due has been entered."
          />
        ) : null}

        {canSeeTeachers ? (
          <Button
            title="By teacher"
            variant="secondary"
            onPress={() => router.push("/staff/reports/teachers")}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  band: { gap: spacing.xs },
});
