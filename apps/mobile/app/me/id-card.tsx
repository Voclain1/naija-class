import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { IdCardView } from "../../src/components/id-card-view";
import { EmptyState, ScreenHeader, Skeleton } from "../../src/components/layout";
import { LoadError } from "../../src/components/load-error";
import { Caption, Screen } from "../../src/components/ui";
import { studentMyIdCard } from "../../src/lib/api/student-portal";
import { useSession } from "../../src/lib/auth/session";
import { queryKeys } from "../../src/lib/query/keys";
import { spacing } from "../../src/theme/tokens";

// The student's own ID card on screen (docs/modules/id-cards-and-store.md §3),
// with its QR code, for the gate or a visit when the plastic card is at home.
export default function MyIdCardScreen() {
  const { status, principal } = useSession();
  const enabled = status === "authenticated" && principal === "student";
  const query = useQuery({ queryKey: queryKeys.myIdCard, queryFn: () => studentMyIdCard(), enabled, staleTime: 10 * 60_000 });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") return <Redirect href="/students" />;

  const data = query.data;
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
      >
        <ScreenHeader title="My ID card" subtitle="Show this, or your printed card, when asked" />
        {query.isLoading ? (
          <Skeleton lines={4} />
        ) : query.isError ? (
          <LoadError error={query.error} what="your ID card" onRetry={() => void query.refetch()} />
        ) : data?.card ? (
          <>
            <IdCardView data={{ ...data, card: data.card }} />
            <Caption>Anyone can scan the code to check that the card is real and current.</Caption>
          </>
        ) : (
          <EmptyState icon="id-card-outline" title="No ID card yet" body="Your school has not issued you a card for this session." />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
});
