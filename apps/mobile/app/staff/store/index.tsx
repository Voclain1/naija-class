import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatKobo } from "@school-kit/types";

import { ChoiceChips } from "../../../src/components/form";
import { ListRow, ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Card, Notice, Screen } from "../../../src/components/ui";
import { WebsiteLink } from "../../../src/components/website-link";
import { staffStoreItems } from "../../../src/lib/api/staff-store";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

const VIEWS = [
  { value: "all", label: "All items" },
  { value: "low", label: "Running low" },
] as const;

// The school store's stock (docs/modules/id-cards-and-store.md §4): what is on
// hand and what is running low. Receiving, issuing, selling and stock takes
// stay on the website, where the ledger and the forms are.
export default function StoreScreen() {
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const permissions = staff?.permissions ?? [];
  const canRead = hasPermission(permissions, "store.read");
  const canManage = hasPermission(permissions, "store.manage");
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const [view, setView] = useState<"all" | "low">("all");

  const items = useQuery({
    queryKey: queryKeys.staffStoreItems(schoolId, userId, view === "low"),
    queryFn: () => staffStoreItems(view === "low"),
    enabled: authed && canRead,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const rows = items.data ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={items.isRefetching} onRefresh={() => void items.refetch()} />}
      >
        <ScreenHeader title="Store" subtitle="Stock on hand" />
        {!canRead ? (
          <Notice tone="info">Your account can&apos;t see the store.</Notice>
        ) : (
          <>
            <ChoiceChips options={VIEWS} value={view} onChange={setView} />
            {items.isLoading ? (
              <Skeleton lines={4} />
            ) : items.isError ? (
              <LoadError error={items.error} what="store items" onRetry={() => void items.refetch()} />
            ) : rows.length === 0 ? (
              <Card>
                <Body muted>
                  {view === "low" ? "Nothing is running low." : "No items yet. Items are added on the website."}
                </Body>
              </Card>
            ) : (
              rows.map((item) => (
                <ListRow
                  key={item.id}
                  icon="cube-outline"
                  title={item.name}
                  subtitle={[
                    `${item.onHand} ${item.unit} on hand`,
                    item.reorderLevel > 0 ? `reorder at ${item.reorderLevel}` : null,
                    item.sellPrice != null ? `sells at ${formatKobo(item.sellPrice)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  meta={item.low ? "Low" : null}
                />
              ))
            )}
          </>
        )}
        {canManage ? <WebsiteLink path="/store" title="Receive, issue and count stock on the website" /> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
});
