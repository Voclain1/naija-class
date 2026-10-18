import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { guardianEmailPreferences, guardianSetEmailPreferences } from "../src/lib/api/portal";
import { ApiError } from "../src/lib/api/client";
import { queryKeys } from "../src/lib/query/keys";
import { useSession } from "../src/lib/auth/session";
import { useTheme } from "../src/theme/theme-provider";
import { spacing } from "../src/theme/tokens";
import { Body, Button, Card, CenteredMessage, Heading, Label, Notice, Screen } from "../src/components/ui";
import { ScreenHeader, Skeleton } from "../src/components/layout";

// Phase 9 / CP11.1 — the parent's Settings, as on the portal
// (docs/modules/phase-9.md §17.11, §20): announcement emails on or off for the
// address the school holds. An address that bounced or was marked as spam is
// blocked until the school fixes it, and says so. Messages from the school
// and receipts are not affected by the switch.

export default function GuardianSettingsScreen() {
  const { status, principal } = useSession();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const authed = status === "authenticated" && principal === "guardian";

  const prefs = useQuery({
    queryKey: queryKeys.guardianEmailPreferences,
    queryFn: guardianEmailPreferences,
    enabled: authed,
  });
  const save = useMutation({
    mutationFn: (announcements: boolean) => guardianSetEmailPreferences(announcements),
    onSuccess: (next) => queryClient.setQueryData(queryKeys.guardianEmailPreferences, next),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "guardian") return <Redirect href="/" />;

  const p = prefs.data;
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title="Settings" />
        <Card style={styles.card}>
          <Heading>Emails</Heading>
          {prefs.isPending ? (
            <Skeleton lines={2} />
          ) : prefs.isError ? (
            <CenteredMessage>
              <Notice tone="danger">We couldn&apos;t load your email setting.</Notice>
              <Button title="Try again" variant="secondary" onPress={() => void prefs.refetch()} />
            </CenteredMessage>
          ) : !p?.email ? (
            <Body muted>The school holds no email address for you. Ask the school to add one.</Body>
          ) : p.blocked ? (
            <Notice tone="warning">
              {`Emails to ${p.email} could not be delivered, so the school has stopped sending them. Ask the school to check your address.`}
            </Notice>
          ) : (
            <View style={styles.row}>
              <View style={styles.text}>
                <Body>Email me the school&apos;s announcements</Body>
                <Label>{`To ${p.email}. Messages from the school and receipts arrive either way.`}</Label>
              </View>
              <Switch
                accessibilityLabel="Email me the school's announcements"
                value={p.announcements}
                disabled={save.isPending}
                onValueChange={(next) => save.mutate(next)}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          )}
          {save.isError ? (
            <Notice tone="danger">
              {save.error instanceof ApiError ? save.error.message : "Your setting could not be saved. Try again."}
            </Notice>
          ) : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  card: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  text: { flex: 1, gap: spacing.xs },
});
