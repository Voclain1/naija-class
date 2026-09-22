import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { formatKobo } from "@school-kit/types";

import { staffListReceipts } from "../../../src/lib/api/staff-money";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { moneyAbilities } from "../../../src/lib/staff/money";
import { spacing } from "../../../src/theme/tokens";
import { Button, Card, CenteredMessage, Notice, Screen } from "../../../src/components/ui";
import { EmptyState, ListRow, ScreenHeader, Skeleton } from "../../../src/components/layout";
import { TextField } from "../../../src/components/form";

// Branded receipts (docs/modules/branded-receipts.md D6) — every receipt the
// school has issued, newest first, searchable by the student's name or
// admission number.
//
// Needed because the family page is reached from "Who owes", and a family that
// has paid in full is no longer on it — this is where their receipt is found.
// Staff-prefixed query key: the list names children and payments, and is never
// written to the phone.

function formatPaidAt(value: Date | string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}

export default function ReceiptsScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const abilities = moneyAbilities(staff?.roles, staff?.permissions ?? []);

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  const receipts = useInfiniteQuery({
    queryKey: queryKeys.staffReceipts(schoolId, userId, search),
    queryFn: ({ pageParam }) => staffListReceipts({ page: pageParam, ...(search ? { search } : {}) }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: authed && abilities.viewReceipts && schoolId !== "",
    staleTime: 30_000,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (!abilities.viewReceipts) {
    return (
      <Screen>
        {header}
        <Notice tone="info">Receipts are issued by owners, administrators and bursars.</Notice>
      </Screen>
    );
  }

  const rows = receipts.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <Screen>
      {header}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Receipts" subtitle="Every receipt issued, newest first." />

        <Card style={styles.card}>
          <TextField label="Student name or admission number" value={query} onChangeText={setQuery} />
          <Button title="Search" disabled={query.trim() === search} onPress={() => setSearch(query.trim())} />
          {search ? <Button title="Show all" variant="secondary" onPress={() => { setQuery(""); setSearch(""); }} /> : null}
        </Card>

        {receipts.isPending ? <Skeleton lines={5} /> : null}

        {receipts.isError && !receipts.data ? (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load receipts. Try again shortly.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void receipts.refetch()} />
          </CenteredMessage>
        ) : null}

        {receipts.data && rows.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title={search ? "No receipts found" : "No receipts yet"}
            body={search ? `Nothing matches "${search}".` : "Receipts appear here as payments are recorded."}
          />
        ) : null}

        {rows.map((row) => (
          <ListRow
            key={row.paymentId}
            icon="receipt-outline"
            title={`${row.studentName} · ${formatKobo(row.amount)}`}
            subtitle={[row.receiptNumber, formatPaidAt(row.paidAt)].filter(Boolean).join(" · ")}
            onPress={() =>
              router.push({
                pathname: "/staff/receipts/[paymentId]",
                params: {
                  paymentId: row.paymentId,
                  receiptNumber: row.receiptNumber,
                  studentName: row.studentName,
                  amount: String(row.amount),
                },
              })
            }
          />
        ))}

        {receipts.hasNextPage ? (
          <Button
            title="Show more"
            variant="secondary"
            loading={receipts.isFetchingNextPage}
            onPress={() => void receipts.fetchNextPage()}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  card: { gap: spacing.sm },
});
