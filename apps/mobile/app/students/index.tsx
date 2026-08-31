import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Link, Redirect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { PortalStudentDto } from "@school-kit/types";

import { listStudents } from "../../src/lib/api/portal";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { useTheme } from "../../src/theme/theme-provider";
import { spacing } from "../../src/theme/tokens";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../src/components/ui";
import { FreshnessLabel, useIsOnline } from "../../src/components/freshness-label";

function fullName(student: PortalStudentDto): string {
  return [student.firstName, student.middleName, student.lastName]
    .filter(Boolean)
    .join(" ");
}

export default function StudentsScreen() {
  const { status, guardian, school, signOut } = useSession();
  const { colors } = useTheme();
  const online = useIsOnline();

  const query = useQuery({
    queryKey: queryKeys.students,
    queryFn: listStudents,
  });

  if (status !== "authenticated") return <Redirect href="/login" />;

  const students = query.data?.data ?? [];
  // `isLoading` is true only when there is NO cached data. With a persisted
  // cache a returning user goes straight to content, so the spinner is for
  // genuine first runs rather than every launch.
  const showSpinner = query.isLoading;
  // A fetch error with cached data present is NOT an error state — it is
  // stale data, which the freshness line already communicates. Only surface
  // it when there is nothing to show.
  const showError = query.isError && students.length === 0;

  return (
    <Screen>
      <View style={styles.header}>
        <Heading>
          {guardian ? `Hello, ${guardian.firstName}` : "Your children"}
        </Heading>
        {school ? <Body muted>{school.name}</Body> : null}
        <FreshnessLabel updatedAt={query.dataUpdatedAt} />
      </View>

      {showSpinner ? (
        <CenteredMessage>
          <Body muted>Loading your children…</Body>
        </CenteredMessage>
      ) : showError ? (
        <CenteredMessage>
          <Notice tone="danger">
            {online
              ? "We couldn't load your children just now."
              : "You're offline and there's no saved copy yet."}
          </Notice>
          <Button title="Try again" variant="secondary" onPress={() => void query.refetch()} />
        </CenteredMessage>
      ) : students.length === 0 ? (
        <CenteredMessage>
          <Body muted>
            No children are linked to your account yet. Your school can add
            them.
          </Body>
        </CenteredMessage>
      ) : (
        <FlatList
          data={students}
          keyExtractor={(student) => student.id}
          contentContainerStyle={styles.list}
          refreshControl={
            // Pull-to-refresh is the ONLY automatic-feeling refresh in the
            // app: everything else is explicit, because a background refetch
            // on a prepaid bundle is money the user did not agree to spend.
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <Link href={`/students/${item.id}`} asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${fullName(item)}`}
              >
                <Card>
                  <Label>{item.admissionNumber}</Label>
                  <Body>{fullName(item)}</Body>
                  <Body muted>
                    {item.currentEnrollment
                      ? `${item.currentEnrollment.classArm.classLevel.name} · ${item.currentEnrollment.classArm.name}`
                      : "Not currently enrolled"}
                  </Body>
                </Card>
              </Pressable>
            </Link>
          )}
        />
      )}

      <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  list: { gap: spacing.sm, paddingBottom: spacing.md },
});
