import { useMemo } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { staffCompleteness } from "../../../src/lib/api/staff-approvals";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import {
  armStage,
  describeStage,
  stageNeedsAction,
} from "../../../src/lib/staff/approval-stage";
import { spacing } from "../../../src/theme/tokens";
import { Button, CenteredMessage, Notice, Screen } from "../../../src/components/ui";
import {
  EmptyState,
  ListRow,
  ScreenHeader,
  SectionHeader,
  Skeleton,
} from "../../../src/components/layout";

// CP4b — every class's report cards, and which ones need the head.
//
// ONE request draws this whole screen (D34): the completeness report already
// carries a count per status for every class. The classes that need the head
// to act — ready to approve, ready to release — are listed first, because
// that is the only reason to open this screen.

export default function ApprovalsScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const permissions = staff?.permissions ?? [];
  const allowed = hasPermission(permissions, "reports.completeness.read");

  const report = useQuery({
    queryKey: queryKeys.staffCompleteness(schoolId, userId, null),
    queryFn: () => staffCompleteness(),
    enabled: authed && allowed && schoolId !== "" && userId !== "",
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    const all = (report.data?.reportCards?.rows ?? []).map((row) => ({
      row,
      stage: armStage(row.byStatus),
    }));
    return {
      action: all.filter((r) => stageNeedsAction(r.stage)),
      rest: all.filter((r) => !stageNeedsAction(r.stage)),
    };
  }, [report.data]);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const term = report.data?.term ?? null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          title="Report cards"
          subtitle={term ? `${term.name} · ${term.academicYearLabel}` : null}
        />

        {!allowed ? (
          <EmptyState
            icon="lock-closed-outline"
            title="Not available on your account"
            body="Approving report cards is for owners and administrators."
          />
        ) : null}

        {allowed && report.isPending ? <Skeleton lines={4} /> : null}

        {report.isError && !report.data ? (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load the report cards. Try again shortly.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void report.refetch()} />
          </CenteredMessage>
        ) : null}

        {report.data && !term ? (
          <EmptyState
            icon="calendar-outline"
            title="No current term"
            body="Set the current term on the website, and report cards will appear here."
          />
        ) : null}

        {report.data && term && rows.action.length === 0 && rows.rest.length === 0 ? (
          <EmptyState
            icon="document-outline"
            title="No classes yet"
            body="There are no classes with students enrolled this term."
          />
        ) : null}

        {rows.action.length > 0 ? (
          <>
            <SectionHeader title="Needs you" note={`${rows.action.length}`} />
            {rows.action.map(({ row, stage }) => (
              <ListRow
                key={row.groupId}
                icon="alert-circle-outline"
                title={row.label}
                subtitle={describeStage(stage, row.byStatus)}
                onPress={() => router.push(`/staff/approvals/${row.groupId}`)}
              />
            ))}
          </>
        ) : null}

        {rows.rest.length > 0 ? (
          <>
            <SectionHeader title="All classes" />
            {rows.rest.map(({ row, stage }) => (
              <ListRow
                key={row.groupId}
                icon={stage === "RELEASED" ? "checkmark-circle-outline" : "document-text-outline"}
                title={row.label}
                subtitle={describeStage(stage, row.byStatus)}
                onPress={() => router.push(`/staff/approvals/${row.groupId}`)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
});
