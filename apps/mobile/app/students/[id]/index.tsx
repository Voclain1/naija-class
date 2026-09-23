import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Link, Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatKobo, type PortalInvoiceDto } from "@school-kit/types";

import { getBankDetails, getStudent, listInvoices } from "../../../src/lib/api/portal";
import { queryKeys } from "../../../src/lib/query/keys";
import { runCheckout } from "../../../src/lib/payments/checkout";
import { describeOutcome, type CheckoutOutcome } from "../../../src/lib/payments/poll";
import { ApiNetworkError } from "../../../src/lib/api/client";
import { useSession } from "../../../src/lib/auth/session";
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
import { FreshnessLabel, useIsOnline } from "../../../src/components/freshness-label";
import { StudentPortalAccess } from "../../../src/components/student-portal-access";
import {
  canPay,
  describeInvoiceStatus,
  invoiceBalance,
  transferClipboardText,
  transferDetails,
} from "../../../src/lib/family/fees";

// Fees, extended 2026-09-23 (phone-for-every-role.md D3) with what the web
// portal showed and the app did not: what each fee is FOR, and the school's
// bank account for a transfer. Paying itself was already here.
//
// Receipts are deliberately NOT here: a receipt is issued by the school
// (C1), and a parent asks the office for theirs.

export default function StudentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status } = useSession();
  const queryClient = useQueryClient();
  const online = useIsOnline();
  const [outcome, setOutcome] = useState<
    { outcome: CheckoutOutcome; invoice: PortalInvoiceDto } | null
  >(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const bankQuery = useQuery({
    queryKey: queryKeys.bankDetails,
    queryFn: () => getBankDetails(),
    enabled: studentId.length > 0,
    staleTime: 30 * 60_000,
    retry: false,
  });

  const pay = useMutation({
    mutationFn: (invoiceId: string) => runCheckout(studentId, invoiceId),
    onMutate: () => {
      setOutcome(null);
      setPayError(null);
    },
    onSuccess: (result, invoiceId) => {
      const invoice = invoicesQuery.data?.data.find((item) => item.id === invoiceId);
      if (invoice) setOutcome({ outcome: result, invoice });
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
  // Shown only when the school both switched transfers on and filled the
  // account in (transferDetails); otherwise there is nothing to promise.
  const transfer = transferDetails(bankQuery.data?.bankTransfer);
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

        {/* Results sit above fees deliberately: a parent opening their
            child's page is far more often checking how they did than paying
            an invoice, and the results screen is the one thing this app can
            show that nothing else in School Kit currently can. */}
        <Link href={`/students/${studentId}/results`} asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="View released results">
            <Card>
              <Heading>Results</Heading>
              <Body muted>Report cards the school has released.</Body>
            </Card>
          </Pressable>
        </Link>

        {/* Phase 8 / CP4 — the class timetable the school PUBLISHED (§18 D39). */}
        <Link href={`/students/${studentId}/timetable`} asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="View class timetable">
            <Card>
              <Heading>Timetable</Heading>
              <Body muted>{"This term’s class timetable, as published by the school."}</Body>
            </Card>
          </Pressable>
        </Link>

        {/* Portal access sits under Results and above Fees: it is a
            one-off setup action, not something a parent returns to daily. */}
        <StudentPortalAccess
          studentId={studentId}
          studentFirstName={student?.firstName ?? null}
        />

        {outcome ? (
          <Notice tone={describeOutcome(outcome.outcome).tone}>
            {describeOutcome(outcome.outcome, {
              studentName: student
                ? [student.firstName, student.lastName].filter(Boolean).join(" ")
                : null,
              termName: outcome.invoice.term.name,
            }).title}
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
            const owed = invoiceBalance(invoice);
            const payable = canPay(invoice);
            return (
              <Card key={invoice.id}>
                <View style={styles.invoiceHead}>
                  <Label>{invoice.term.name}</Label>
                  <Label>{describeInvoiceStatus(invoice.status)}</Label>
                </View>
                {/* What the fee is FOR — the school's own lines, at the
                    amount the server worked out after its discounts. */}
                {invoice.items.map((item, index) => (
                  <View key={`${invoice.id}-${index}`} style={styles.invoiceLine}>
                    <Body muted>{`${item.categoryName} · ${item.feeName}`}</Body>
                    <Body muted>{formatKobo(item.netAmount)}</Body>
                  </View>
                ))}
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

        {transfer ? (
          <Card>
            <Label>Or pay by bank transfer</Label>
            <Heading>{transfer.bankAccountNumber}</Heading>
            <Body muted>{`${transfer.bankName} · ${transfer.bankAccountName}`}</Body>
            <Body muted>
              {`Use ${student?.admissionNumber ?? "your child's admission number"} as the reference so the school knows who paid. A transfer shows here once the school records it.`}
            </Body>
            <Button
              title={copied ? "Copied" : "Copy account details"}
              variant="secondary"
              onPress={() => {
                if (!transfer) return;
                void Clipboard.setStringAsync(
                  transferClipboardText(transfer, student?.admissionNumber ?? ""),
                ).then(() => setCopied(true));
              }}
            />
          </Card>
        ) : null}

        <Label>Receipts are issued by the school — ask the office and they will send yours.</Label>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  invoiceHead: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  invoiceLine: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  header: { gap: spacing.xs, marginBottom: spacing.sm },
});
