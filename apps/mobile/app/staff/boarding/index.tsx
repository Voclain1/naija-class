import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { HOSTEL_GENDER_LABEL } from "@school-kit/types";

import { ListRow, ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Card, Notice, Screen } from "../../../src/components/ui";
import { staffMyHostels } from "../../../src/lib/api/staff-boarding";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP6b.2 — the hostels this person keeps (docs/modules/phase-9.md
// §15 CP6b-D4): their own as house master, or every one for owner and admin.
export default function BoardingScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canKeep = hasPermission(staff?.permissions ?? [], "hostel.house");
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";

  const hostels = useQuery({
    queryKey: queryKeys.staffBoardingHostels(schoolId, userId),
    queryFn: staffMyHostels,
    enabled: authed && canKeep,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const rows = hostels.data ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={hostels.isRefetching} onRefresh={() => void hostels.refetch()} />}
      >
        <ScreenHeader title="Boarding" subtitle="Boarders and visitors" />
        {!canKeep ? (
          <Notice tone="info">Your account can&apos;t see the hostels.</Notice>
        ) : hostels.isLoading ? (
          <Skeleton lines={3} />
        ) : hostels.isError ? (
          <LoadError error={hostels.error} what="hostels" onRetry={() => void hostels.refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <Body muted>You are not house master of any hostel yet. The school&apos;s admin chooses house masters on the website.</Body>
          </Card>
        ) : (
          rows.map((h) => (
            <ListRow
              key={h.id}
              icon="bed-outline"
              title={h.name}
              subtitle={`${HOSTEL_GENDER_LABEL[h.forGender]} · ${h.boarders} ${h.boarders === 1 ? "boarder" : "boarders"} this term`}
              onPress={() => router.push({ pathname: "/staff/boarding/[hostelId]", params: { hostelId: h.id } })}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
});
