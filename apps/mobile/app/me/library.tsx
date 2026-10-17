import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, ScreenHeader, Skeleton } from "../../src/components/layout";
import { LibraryLoanRows } from "../../src/components/library-card";
import { LoadError } from "../../src/components/load-error";
import { Card, Screen } from "../../src/components/ui";
import { studentLibrary } from "../../src/lib/api/student-portal";
import { useSession } from "../../src/lib/auth/session";
import { queryKeys } from "../../src/lib/query/keys";
import { spacing } from "../../src/theme/tokens";

// Phase 9 / CP6.2 — the student's own library books out and when each is due
// (docs/modules/phase-9.md §14 CP6-D6). Whether a book is overdue is the
// server's judgement against the school's day, never the phone's clock.
export default function MyLibraryScreen() {
  const { status, principal } = useSession();
  const query = useQuery({
    queryKey: queryKeys.myLibrary,
    queryFn: () => studentLibrary(),
    enabled: status === "authenticated" && principal === "student",
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") return <Redirect href="/students" />;

  const loans = query.data?.loans ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
      >
        <ScreenHeader title="My library books" subtitle="Books you have out and when they are due" />
        {query.isLoading ? (
          <Skeleton lines={3} />
        ) : query.isError ? (
          <LoadError error={query.error} what="your library books" onRetry={() => void query.refetch()} />
        ) : loans.length === 0 ? (
          <EmptyState icon="library-outline" title="No books out" body="Books you borrow from the school library show here with their due dates." />
        ) : (
          <Card>
            <LibraryLoanRows loans={loans} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
});
