import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatKobo, invoiceStatusLabel, type PortalInvoiceDto } from "@school-kit/types";

import { listStudentFees } from "../../src/lib/api/student-portal";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { spacing } from "../../src/theme/tokens";
import {
  Body,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../src/components/ui";
import { FreshnessLabel } from "../../src/components/freshness-label";

// A student's own fees. READ ONLY, and that is the whole design.
//
// This screen shows the same invoices the parent sees, from the same server
// query — but it has no Pay button, because there is no student pay endpoint
// to call. Paying is the guardian's action and stays with the principal who
// owns the money.
//
// Every figure here is rendered from what the API returned. Nothing is summed,
// netted or discounted on this side (CLAUDE.md: the frontend displays what the
// API returned, full stop) — including the outstanding balance below, which is
// a subtraction of two server-computed kobo integers purely for display.

/** Kobo owed on an invoice. Both operands come from the server. */
function outstanding(invoice: PortalInvoiceDto): number {
  return invoice.totalDue - invoice.totalPaid;
}

const FIVE_MINUTES_MS = 1000 * 60 * 5;

export default function MyFeesScreen() {
  const { status, principal } = useSession();

  const query = useQuery({
    queryKey: queryKeys.myFees,
    queryFn: listStudentFees,
    enabled: status === "authenticated" && principal === "student",
    // Short, unlike results: a parent may pay at any moment, and a stale
    // "you owe this" is the one figure here a child might repeat out loud.
    staleTime: FIVE_MINUTES_MS,
  });

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") {
    return <Redirect href="/students" />;
  }

  const invoices: PortalInvoiceDto[] = query.data?.data ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "My fees" }} />
      <ScrollView contentContainerStyle={styles.content}>
        {query.isPending && (
          <CenteredMessage>
            <Body muted>Loading your fees…</Body>
          </CenteredMessage>
        )}

        {query.isError && !query.data && (
          <CenteredMessage>
            <Notice tone="danger">
              We couldn&apos;t load your fees. Try again shortly.
            </Notice>
          </CenteredMessage>
        )}

        {query.data && (
          <>
            <FreshnessLabel updatedAt={query.dataUpdatedAt} />

            {invoices.length === 0 ? (
              <Card>
                <Heading>No invoices yet</Heading>
                <Body>
                  When your school issues a fee invoice, it will appear here.
                </Body>
              </Card>
            ) : (
              invoices.map((invoice) => {
                const owed = outstanding(invoice);
                return (
                  <Card key={invoice.id}>
                    <Heading>{invoice.term.name}</Heading>
                    <Body muted>{invoiceStatusLabel[invoice.status]}</Body>

                    <View style={styles.row}>
                      <View style={styles.metric}>
                        <Label>Total</Label>
                        <Body>{formatKobo(invoice.totalDue)}</Body>
                      </View>
                      <View style={styles.metric}>
                        <Label>Paid</Label>
                        <Body>{formatKobo(invoice.totalPaid)}</Body>
                      </View>
                      <View style={styles.metric}>
                        <Label>Outstanding</Label>
                        <Body>{formatKobo(owed)}</Body>
                      </View>
                    </View>

                    {invoice.items.length > 0 ? (
                      <View style={styles.items}>
                        <Label>What this covers</Label>
                        {invoice.items.map((item) => (
                          <View key={item.feeItemId} style={styles.itemRow}>
                            <Body>{item.feeName}</Body>
                            {/* netAmount, not amount: it is the figure after
                                the discounts the school actually applied, and
                                it is what the invoice total is built from.
                                Showing the pre-discount amount here would not
                                add up to the Total above. */}
                            <Body>{formatKobo(item.netAmount)}</Body>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {owed > 0 ? (
                      // Said plainly rather than as a call to action: the
                      // child cannot pay from here, and a button they cannot
                      // use would be worse than none.
                      <Body muted>Your parent or guardian can pay this in their app.</Body>
                    ) : null}
                  </Card>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  metric: { alignItems: "flex-start" },
  items: { marginTop: spacing.sm, gap: spacing.xs },
  itemRow: { flexDirection: "row", justifyContent: "space-between" },
});
