import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatKobo } from "@school-kit/types";

import { staffFinanceDashboard } from "../../../src/lib/api/staff-finance";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useTermContext } from "../../../src/lib/staff/use-term-context";
import { termResolutionMessage } from "../../../src/lib/staff/term-context";
import { spacing } from "../../../src/theme/tokens";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../../src/components/ui";

// Collections at a glance, for the current term.
//
// READ-ONLY by design, not by omission. Nothing here records a payment, sends
// a reminder or touches a refund — those stay web-only per the plan-first, and
// the screen says so rather than leaving a bursar hunting for a button that
// was never going to be there.
//
// The phone computes NO money. `collectionRatePercent` and `netPosition` are
// server-computed and rendered exactly as returned; `formatKobo` is the only
// transformation applied, at the display layer, per CLAUDE.md's money rules.

export default function CollectionsScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const canRead = hasPermission(staff?.permissions ?? [], "finance.dashboard.read");

  const termContext = useTermContext({ schoolId, userId, enabled: authed && canRead });
  const termId = termContext.data?.term?.termId ?? "";

  const dashboard = useQuery({
    queryKey: queryKeys.staffCollections(schoolId, userId, termId),
    queryFn: () => staffFinanceDashboard(termId),
    enabled: authed && canRead && termId !== "",
    staleTime: 60_000,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const failure = termContext.data?.failure ?? null;
  const data = dashboard.data;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Collections" }} />
      <Heading>Collections</Heading>
      {termContext.data?.term ? (
        <Body muted>
          {termContext.data.term.termName} · {termContext.data.term.yearLabel}
        </Body>
      ) : (
        <Body muted>Finding the current term…</Body>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {!canRead && (
          <Notice tone="warning">
            Your account doesn&apos;t have access to collection figures.
          </Notice>
        )}

        {/*
          A named term-resolution failure, not a blank screen. The web finance
          dashboard learned this the hard way (#198/#200): both selectors
          default off `isCurrent`, a MANUALLY set flag, and when nothing is
          flagged current the page dead-ended with no explanation. Same failure
          is reachable here, so it gets the same treatment — say which of the
          four things is missing, because "no current term" is a two-tap fix in
          settings and "no academic year at all" is not.
        */}
        {failure && <Notice tone="warning">{termResolutionMessage(failure)}</Notice>}

        {canRead && !failure && (termContext.isPending || dashboard.isPending) && (
          <CenteredMessage>
            <Body muted>Loading collections…</Body>
          </CenteredMessage>
        )}

        {(termContext.isError || dashboard.isError) && !data && (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load collections. Try again shortly.</Notice>
            <Button
              title="Try again"
              variant="secondary"
              onPress={() => {
                void termContext.refetch();
                void dashboard.refetch();
              }}
            />
          </CenteredMessage>
        )}

        {data && data.totalInvoiced === 0 && (
          <Notice tone="info">
            Nothing has been invoiced for this term yet, so there is nothing to collect. A
            collection rate would be misleading rather than zero.
          </Notice>
        )}

        {data && data.totalInvoiced > 0 && (
          <>
            <Card style={styles.card}>
              <Label>Collected</Label>
              <Heading>{formatKobo(data.totalCollected)}</Heading>
              <Body muted>
                of {formatKobo(data.totalInvoiced)} invoiced · {data.collectionRatePercent}%
              </Body>
            </Card>

            <Card style={styles.card}>
              <Label>Outstanding</Label>
              <Heading>{formatKobo(data.outstandingBalance)}</Heading>
              <Body muted>
                across {data.debtorCount} unpaid invoice{data.debtorCount === 1 ? "" : "s"}
              </Body>
            </Card>

            <Card style={styles.card}>
              <Label>Expenses this term</Label>
              <Body>{formatKobo(data.totalExpenses)}</Body>
              <Label>Net position</Label>
              <Body>{formatKobo(data.netPosition)}</Body>
            </Card>

            <View style={styles.actions}>
              <Button
                title={`See who owes (${data.debtorCount})`}
                onPress={() => router.push("/staff/collections/debtors")}
                disabled={data.debtorCount === 0}
              />
            </View>
          </>
        )}

        <Notice tone="info">
          Recording payments, refunds and reminders stay on the web app. This screen is
          read-only.
        </Notice>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  card: { gap: spacing.xs },
  actions: { paddingTop: spacing.sm },
});
