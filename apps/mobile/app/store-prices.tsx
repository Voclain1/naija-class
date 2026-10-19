import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { STORE_CATEGORY_LABELS, formatKobo } from "@school-kit/types";

import { EmptyState } from "../src/components/layout";
import { Body, Button, Caption, Card, CenteredMessage, Label, Notice, Screen } from "../src/components/ui";
import { getStorePrices } from "../src/lib/api/portal";
import { useSession } from "../src/lib/auth/session";
import { queryKeys } from "../src/lib/query/keys";
import { useTheme } from "../src/theme/theme-provider";
import { spacing } from "../src/theme/tokens";

// The school store's price list for a parent (2026-10-19,
// docs/modules/id-cards-and-store.md §4b). Read-only: buying is done at the
// school, and the amount goes on the child's bill.
export default function StorePricesScreen() {
  const { status, principal } = useSession();
  const { colors } = useTheme();
  const query = useQuery({
    queryKey: queryKeys.storePrices(),
    queryFn: getStorePrices,
    enabled: status === "authenticated" && principal === "guardian",
  });

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "guardian") return <Redirect href="/" />;

  const list = query.data;
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "School store prices" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}
      >
        <Body muted>What the school store sells and the price. Buy at the school; the amount goes on your child&apos;s bill.</Body>
        {query.isPending && (
          <CenteredMessage>
            <Body muted>Loading prices…</Body>
          </CenteredMessage>
        )}
        {query.isError && !list && (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load the price list just now.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void query.refetch()} />
          </CenteredMessage>
        )}
        {list && !list.shown && (
          <EmptyState icon="pricetags-outline" title="The school has not shared its store prices" body="Ask the school office for the price of anything you need." />
        )}
        {list && list.shown && list.items.length === 0 && (
          <EmptyState icon="pricetags-outline" title="No prices yet" body="Items appear here once the school sets their selling price." />
        )}
        {list?.shown &&
          list.items.map((item) => (
            <Card key={item.id} style={styles.card}>
              <View style={styles.head}>
                <Label>{item.name}</Label>
                <Caption>{STORE_CATEGORY_LABELS[item.category]}</Caption>
              </View>
              {item.sizes.map((size, i) => (
                <View key={`${size.label ?? ""}-${i}`} style={styles.row}>
                  <Body>{size.label ?? `Per ${item.unit}`}</Body>
                  <View style={styles.right}>
                    <Body>{formatKobo(size.price)}</Body>
                    <Caption>{size.available ? "Available" : "Out of stock"}</Caption>
                  </View>
                </View>
              ))}
            </Card>
          ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, padding: spacing.md },
  card: { gap: spacing.sm },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  right: { alignItems: "flex-end" },
});
