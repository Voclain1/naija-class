import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatKobo } from "@school-kit/types";

import { staffDebtors } from "../../../src/lib/api/staff-finance";
import { staffSendReminders } from "../../../src/lib/api/staff-money";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { moneyAbilities } from "../../../src/lib/staff/money";
import { filterDebtors } from "../../../src/lib/staff/bursar";
import { TextField } from "../../../src/components/form";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useTermContext } from "../../../src/lib/staff/use-term-context";
import { termResolutionMessage } from "../../../src/lib/staff/term-context";
import { spacing } from "../../../src/theme/tokens";
import { EmptyState, ScreenHeader, Skeleton } from "../../../src/components/layout";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
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
//      answer. CP9b's reminders keep it that way: the phone sends student ids
//      and the SERVER looks up each family's contact — the phone never holds a
//      parent's phone number to send one.
//
// CP9b (D38): each row opens that family's page (record a payment, remind,
// share a payment link), and "Remind every family" sends in batches of the
// server's limit after a confirmation that says texts cost money.

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

  const router = useRouter();
  const abilities = moneyAbilities(staff?.roles, staff?.permissions ?? []);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [remindFailure, setRemindFailure] = useState<string | null>(null);

  const remindAll = useMutation({
    mutationFn: (studentIds: string[]) => staffSendReminders(termId, studentIds),
    onMutate: () => {
      setNotice(null);
      setRemindFailure(null);
    },
    onSuccess: (result) =>
      setNotice(
        `Reminders sent to ${result.sent} famil${result.sent === 1 ? "y" : "ies"}.` +
          (result.skipped > 0 ? ` ${result.skipped} could not be reached (no main contact, or already paid).` : ""),
      ),
    onError: (error) =>
      setRemindFailure(
        error instanceof ApiNetworkError
          ? "Your phone lost the connection while sending. Some reminders may have gone — check before sending again, so no family is texted twice."
          : error instanceof ApiError
            ? error.message
            : "The reminders could not be sent.",
      ),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const failure = termContext.data?.failure ?? null;
  const all = debtors.data ?? [];
  // Filtered on the phone, not the server: the whole term's debtor list is
  // already here, and a bursar with a parent at the counter should not wait
  // for a round trip to find them.
  const rows = filterDebtors(all, search);
  const totalOwed = all.reduce((sum, r) => sum + r.balance, 0);

  function confirmRemindAll(): void {
    const ids = [...new Set(rows.map((r) => r.studentId))];
    Alert.alert(
      `Remind ${ids.length} famil${ids.length === 1 ? "y" : "ies"}?`,
      `Every family that owes this term gets a reminder of their balance, through the channels your school has switched on (app notification, email, text). Texts are charged to the school — up to ${ids.length} of them.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send reminders", onPress: () => remindAll.mutate(ids) },
      ],
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScreenHeader title="Who owes" />
      {all.length > 0 ? (
        <TextField
          label="Find a family"
          value={search}
          onChangeText={setSearch}
          placeholder="Name, admission number or class"
        />
      ) : null}

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
          <Skeleton lines={4} />
        )}

        {debtors.isError && !debtors.data && (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load the debtor list.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void debtors.refetch()} />
          </CenteredMessage>
        )}

        {debtors.data && all.length > 0 && rows.length === 0 ? (
          <EmptyState
            icon="search-outline"
            title="No family matches"
            body={`Nobody owing matches "${search.trim()}".`}
          />
        ) : null}

        {debtors.data && all.length === 0 && (
          <EmptyState
            icon="checkmark-circle-outline"
            title="Nothing owed"
            body="Every invoice for this term is fully paid."
          />
        )}

        {notice ? <Notice tone="info">{notice}</Notice> : null}
        {remindFailure ? <Notice tone="danger">{remindFailure}</Notice> : null}
        {abilities.remind && rows.length > 0 ? (
          <Button
            title="Remind every family"
            variant="secondary"
            loading={remindAll.isPending}
            disabled={remindAll.isPending}
            onPress={confirmRemindAll}
          />
        ) : null}

        {rows.map((row) => (
          <Pressable
            key={row.invoiceId}
            accessibilityRole="button"
            accessibilityLabel={`${row.studentName}, ${formatKobo(row.balance)} outstanding`}
            onPress={() =>
              router.push({
                pathname: "/staff/collections/[invoiceId]",
                params: { invoiceId: row.invoiceId, termId },
              })
            }
          >
          <Card style={styles.row}>
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
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingVertical: spacing.md },
  row: { gap: spacing.xs },
  rowHead: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
});
