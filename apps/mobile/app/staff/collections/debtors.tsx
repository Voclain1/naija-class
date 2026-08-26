import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatKobo } from "@school-kit/types";

import { staffDebtors } from "../../../src/lib/api/staff-finance";
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

// Who owes, for the current term.
//
// This is the most sensitive payload the staff app carries: every family in
// the school that owes money, by name and amount. Two consequences that are
// not stylistic:
//
//   1. The query key begins ["staff", …] so the persister refuses it — see
//      staff-keys.spec.ts, which asserts the ACTUAL keys these screens build.
//      A debtor list in plaintext AsyncStorage on a shared staffroom handset
//      is the failure this rule exists to prevent.
//   2. DebtorDto carries NO guardian phone, email or address, and CP3 does not
//      add any. finance.mobile-cp3.spec.ts asserts the key set EXACTLY, so a
//      future field cannot arrive here quietly. "Who owes" is a finance
//      question; "how to reach them" is a different one with a different
//      answer, and the reminder flow that needs it stays on web.

export default function DebtorsScreen() {
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const canRead = hasPermission(staff?.permissions ?? [], "finance.debtors.read");

  const termContext = useTermContext({ schoolId, userId, enabled: authed && canRead });
  const termId = termContext.data?.term?.termId ?? "";

  const debtors = useQuery({
    queryKey: queryKeys.staffDebtors(schoolId, userId, termId),
    queryFn: () => staffDebtors(termId),
    enabled: authed && canRead && termId !== "",
    staleTime: 60_000,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const failure = termContext.data?.failure ?? null;
  const rows = debtors.data ?? [];
  const totalOwed = rows.reduce((sum, r) => sum + r.balance, 0);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Who owes" }} />
      <Heading>Who owes</Heading>
      {termContext.data?.term && (
        <Body muted>
          {termContext.data.term.termName} · {rows.length} unpaid ·{" "}
          {formatKobo(totalOwed)} outstanding
        </Body>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {!canRead && (
          <Notice tone="warning">
            Your account doesn&apos;t have access to the debtor list.
          </Notice>
        )}

        {failure && <Notice tone="warning">{termResolutionMessage(failure)}</Notice>}

        {canRead && !failure && debtors.isPending && (
          <CenteredMessage>
            <Body muted>Loading…</Body>
          </CenteredMessage>
        )}

        {debtors.isError && !debtors.data && (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load the debtor list.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void debtors.refetch()} />
          </CenteredMessage>
        )}

        {debtors.data && rows.length === 0 && (
          <Notice tone="info">Every invoice for this term is fully paid.</Notice>
        )}

        {rows.map((row) => (
          <Card key={row.invoiceId} style={styles.row}>
            <View style={styles.rowHead}>
              <Body>{row.studentName}</Body>
              <Body>{formatKobo(row.balance)}</Body>
            </View>
            <Label>
              {row.classArm} · {row.admissionNumber}
            </Label>
            <Label>
              {formatKobo(row.totalPaid)} paid of {formatKobo(row.totalDue)}
              {row.dueDate ? ` · due ${row.dueDate}` : ""}
              {row.hasPaymentPlan ? " · on a payment plan" : ""}
            </Label>
          </Card>
        ))}

        {rows.length > 0 && (
          <Notice tone="info">
            Reminders are sent from the web app. This list is read-only.
          </Notice>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingVertical: spacing.md },
  row: { gap: spacing.xs },
  rowHead: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
});
