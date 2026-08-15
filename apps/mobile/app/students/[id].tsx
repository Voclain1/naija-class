import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatKobo, type PortalInvoiceDto } from "@school-kit/types";

import { getStudent, listInvoices } from "../../src/lib/api/portal";
import { queryKeys } from "../../src/lib/query/keys";
import { runCheckout } from "../../src/lib/payments/checkout";
import { describeOutcome, type CheckoutOutcome } from "../../src/lib/payments/poll";
import { ApiNetworkError } from "../../src/lib/api/client";
import { useSession } from "../../src/lib/auth/session";
import { spacing } from "../../src/theme/tokens";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../src/components/ui";
import { FreshnessLabel, useIsOnline } from "../../src/components/freshness-label";

/** An invoice is payable when the school is still owed money on it. */
function outstanding(invoice: PortalInvoiceDto): number {
  return invoice.totalDue - invoice.totalPaid;
}

export default function StudentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status } = useSession();
  const queryClient = useQueryClient();
  const online = useIsOnline();
  const [outcome, setOutcome] = useState<CheckoutOutcome | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  const studentId = typeof id === "string" ? id : "";

  const studentQuery = useQuery({
    queryKey: queryKeys.student(studentId),
    queryFn: () => getStudent(studentId),
    enabled: studentId.length > 0,
  });

  const invoicesQuery = useQuery({
    queryKey: queryKeys.invoices(studentId),
    queryFn: () => listInvoices(studentId),
    enabled: studentId.length > 0,
  });

  const pay = useMutation({
    mutationFn: (invoiceId: string) => runCheckout(studentId, invoiceId),
    onMutate: () => {
      setOutcome(null);
      setPayError(null);
    },
    onSuccess: (result) => {
      setOutcome(result);
      // Re-read the invoice from the server rather than adjusting anything
      // locally. CLAUDE.md's Money rules are explicit that the frontend never
      // computes balances — it displays what the API returned.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.invoices(studentId),
      });
    },
    onError: (error) => {
      setPayError(
        error instanceof ApiNetworkError
          ? // This is D9 in practice. The mutation was NOT queued for later:
            // it failed now, and the user is told now.
            "You're offline, so this payment wasn't started. Reconnect and try again."
          : "We couldn't start that payment. Please try again.",
      );
    },
  });

  if (status !== "authenticated") return <Redirect href="/login" />;

  const student = studentQuery.data;
  const invoices = invoicesQuery.data?.data ?? [];
  const oldestUpdate = Math.min(
    studentQuery.dataUpdatedAt || Infinity,
    invoicesQuery.dataUpdatedAt || Infinity,
  );

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "" }} />
      <ScrollView contentContainerStyle={styles.content}>
        {student ? (
          <View style={styles.header}>
            <Heading>
              {[student.firstName, student.lastName].filter(Boolean).join(" ")}
            </Heading>
            <Body muted>
              {student.currentEnrollment
                ? `${student.currentEnrollment.classArm.classLevel.name} · ${student.currentEnrollment.classArm.name}`
                : "Not currently enrolled"}
            </Body>
            {/* Deliberately the OLDER of the two timestamps: the screen is
                only as fresh as its stalest part, and quoting the newer one
                would overstate how current the fee figures are. */}
            <FreshnessLabel
              updatedAt={Number.isFinite(oldestUpdate) ? oldestUpdate : 0}
            />
          </View>
        ) : studentQuery.isLoading ? (
          <CenteredMessage>
            <Body muted>Loading…</Body>
          </CenteredMessage>
        ) : (
          <Notice tone="danger">
            {online
              ? "We couldn't load this child's details."
              : "You're offline and there's no saved copy of this page."}
          </Notice>
        )}

        {outcome ? (
          <Notice tone={describeOutcome(outcome).tone}>
            {describeOutcome(outcome).title}
          </Notice>
        ) : null}
        {payError ? <Notice tone="danger">{payError}</Notice> : null}

        <Label>Fees</Label>

        {invoicesQuery.isLoading ? (
          <Body muted>Loading fees…</Body>
        ) : invoices.length === 0 ? (
          <Body muted>No invoices have been issued yet.</Body>
        ) : (
          invoices.map((invoice) => {
            const owed = outstanding(invoice);
            const payable = owed > 0;
            return (
              <Card key={invoice.id}>
                <Label>{invoice.term.name}</Label>
                <Body>{formatKobo(invoice.totalDue)} due</Body>
                <Body muted>
                  {formatKobo(invoice.totalPaid)} paid
                  {payable ? ` · ${formatKobo(owed)} outstanding` : " · settled"}
                </Body>
                {payable ? (
                  <Button
                    title={`Pay ${formatKobo(owed)}`}
                    // One in-flight checkout at a time, app-wide. Two
                    // concurrent Paystack sessions for the same family is a
                    // duplicate-payment risk, not a convenience.
                    loading={pay.isPending && pay.variables === invoice.id}
                    disabled={pay.isPending}
                    onPress={() => pay.mutate(invoice.id)}
                  />
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  header: { gap: spacing.xs, marginBottom: spacing.sm },
});
