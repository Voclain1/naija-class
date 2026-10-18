import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatKobo, type LibraryLoanDto } from "@school-kit/types";

import { ChoiceChips } from "../../../src/components/form";
import { EmptyState, ListRow, ScreenHeader, Skeleton } from "../../../src/components/layout";
import { formatLibraryDay } from "../../../src/components/library-card";
import { LoadError } from "../../../src/components/load-error";
import { Body, Button, Caption, Card, Notice, Screen } from "../../../src/components/ui";
import { staffLibraryFound, staffLibraryLoans } from "../../../src/lib/api/staff-library";
import { ApiError } from "../../../src/lib/api/client";
import { foundNotice } from "../../../src/lib/staff/library";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";
import { WebsiteLink } from "../../../src/components/website-link";

// Phase 9 / CP6.2 — the library's loans on the staff app (docs/modules/
// phase-9.md §14 CP6-D5): books out now and the overdue ones, with the fine so
// far on a late student's book (the API's estimate). The catalogue stays on
// the website; the lending desk is one tap away. CP11.2 adds the Lost books,
// with "Found it" as on the website (§20).

type State = "OPEN" | "OVERDUE" | "LOST";
const STATES = [
  { value: "OVERDUE" as const, label: "Overdue" },
  { value: "OPEN" as const, label: "Out now" },
  { value: "LOST" as const, label: "Lost" },
];

function loanSubtitle(l: LibraryLoanDto): string {
  const due = l.overdue
    ? `Overdue by ${l.daysLate} ${l.daysLate === 1 ? "day" : "days"}`
    : `Due ${formatLibraryDay(l.dueOn)}`;
  const fine = l.fineSoFar ? ` · fine so far ${formatKobo(l.fineSoFar)}` : "";
  return `${l.borrower.name} (${l.borrower.detail}) · ${due}${fine}`;
}

export default function LibraryLoansScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const permissions = staff?.permissions ?? [];
  const canRead = hasPermission(permissions, "library.read");
  const canLend = hasPermission(permissions, "library.lend");
  // CP11.2: the catalogue and class reading are kept on the website.
  const canCatalogue = hasPermission(permissions, "library.manage");
  const canResources = hasPermission(permissions, "library.resource.write");
  const [state, setState] = useState<State>("OVERDUE");
  const [notice, setNotice] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const found = useMutation({
    mutationFn: (loanId: string) => staffLibraryFound(loanId),
    onMutate: () => setNotice(null),
    onSuccess: async (r) => {
      setNotice(foundNotice(r.charge));
      await queryClient.invalidateQueries({ queryKey: queryKeys.staffLibraryLoans(staff?.school.id ?? "", staff?.user.id ?? "", "LOST").slice(0, 4) });
    },
  });

  const loans = useQuery({
    queryKey: queryKeys.staffLibraryLoans(staff?.school.id ?? "", staff?.user.id ?? "", state),
    queryFn: () => staffLibraryLoans(state),
    enabled: authed && canRead,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const rows = loans.data ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loans.isRefetching} onRefresh={() => void loans.refetch()} />}
      >
        <ScreenHeader title="Library" subtitle="Books out, and the late ones" />
        {!canRead ? (
          <Notice tone="info">Your account can&apos;t see the library.</Notice>
        ) : (
          <>
            {canLend ? <Button title="Open the lending desk" onPress={() => router.push("/staff/library/desk")} /> : null}
            <ChoiceChips options={STATES} value={state} onChange={setState} />
            {notice ? <Notice tone="info">{notice}</Notice> : null}
            {found.isError ? (
              <Notice tone="danger">{found.error instanceof ApiError ? found.error.message : "That did not work. Try again."}</Notice>
            ) : null}
            {loans.isLoading ? (
              <Skeleton lines={4} />
            ) : loans.isError ? (
              <LoadError error={loans.error} what="loans" onRetry={() => void loans.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon="library-outline"
                title={state === "OVERDUE" ? "No books are overdue" : state === "LOST" ? "No books are marked lost" : "No books are out"}
                body="Books lent at the desk, here or on the website, show here."
              />
            ) : (
              state === "LOST" ? (
                rows.map((l) => (
                  <Card key={l.id} style={styles.card}>
                    <Body>{l.title}</Body>
                    <Caption>
                      {`${l.borrower.name} (${l.borrower.detail}) · No. ${l.accessionNumber} · lost ${l.lostAt ? formatLibraryDay(l.lostAt) : ""}${l.foundAt ? `, found ${formatLibraryDay(l.foundAt)}` : ""}`}
                    </Caption>
                    {canLend && l.lostAt && !l.foundAt ? (
                      <Button
                        variant="secondary"
                        title="Found it"
                        loading={found.isPending && found.variables === l.id}
                        disabled={found.isPending}
                        onPress={() => found.mutate(l.id)}
                      />
                    ) : null}
                  </Card>
                ))
              ) : rows.map((l) => (
                <ListRow
                  key={l.id}
                  icon={l.overdue ? "alert-circle-outline" : "book-outline"}
                  title={l.title}
                  subtitle={loanSubtitle(l)}
                  meta={`No. ${l.accessionNumber}`}
                />
              ))
            )}
            {canCatalogue ? <WebsiteLink path="/library" title="The catalogue on the website" hint="Adding books and copies is on the website." /> : null}
            {canResources ? <WebsiteLink path="/library/resources" title="Add reading for a class" /> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  card: { gap: spacing.xs },
});
