import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { PortalStudentDto } from "@school-kit/types";

import { guardianHomework, listInvoices, listResults, listStudents } from "../../src/lib/api/portal";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { useTheme } from "../../src/theme/theme-provider";
import { AppMenu, MenuButton, useAppMenu } from "../../src/components/app-menu";
import { guardianDestinations } from "../../src/lib/navigation/destinations";
import { childHighlight, initials } from "../../src/lib/family/today";
import { greeting } from "../../src/lib/when";
import { fontSizes, fonts, radii, spacing } from "../../src/theme/tokens";
import { Body, Button, Card, CenteredMessage, Label, Notice, Screen } from "../../src/components/ui";
import { EmptyState, ListRow, ScreenHeader, SectionHeader, Skeleton } from "../../src/components/layout";
import { FreshnessLabel, useIsOnline } from "../../src/components/freshness-label";

// A parent's home, redesigned to match the staff app (D4).
//
// One card per child, each carrying the ONE line worth a parent's attention —
// money owed, or freshly released results — and nothing when there is nothing
// (childHighlight). A home that always shows a banner teaches people to
// ignore banners.
//
// The per-child fee and result queries are ordinary cached reads with a long
// staleTime, not a background poll: families are on prepaid data, and this
// app's rule is that the only automatic-feeling refresh is pull-to-refresh.

function fullName(student: PortalStudentDto): string {
  return [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
}

export default function StudentsScreen() {
  const { status, guardian, school, signOut } = useSession();
  const { colors } = useTheme();
  const router = useRouter();
  const menu = useAppMenu();
  const online = useIsOnline();

  const query = useQuery({ queryKey: queryKeys.students, queryFn: listStudents });
  const students = query.data?.data ?? [];

  const extras = useQueries({
    queries: students.flatMap((student) => [
      {
        queryKey: queryKeys.invoices(student.id),
        queryFn: () => listInvoices(student.id),
        staleTime: 5 * 60_000,
      },
      {
        queryKey: queryKeys.results(student.id),
        queryFn: () => listResults(student.id),
        staleTime: 5 * 60_000,
      },
      // Homework is the third read per child, and the one with a short life:
      // fees and results keep for the day, "due tomorrow" does not.
      {
        queryKey: queryKeys.guardianHomework(student.id),
        queryFn: () => guardianHomework(student.id),
        staleTime: 60_000,
      },
    ]),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (status !== "authenticated") return <Redirect href="/login" />;

  // `isLoading` is true only when there is NO cached data, so a returning
  // parent goes straight to content (the persisted cache) rather than a
  // spinner. A fetch error WITH cached data is not an error state — it is
  // stale data, which the freshness line already says.
  const showSpinner = query.isLoading;
  const showError = query.isError && students.length === 0;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        <ScreenHeader
          title={`${greeting(new Date().getHours())}${guardian ? `, ${guardian.firstName}` : ""}`}
          subtitle={school?.name ?? null}
          action={<MenuButton onPress={menu.open} />}
        />
        <FreshnessLabel updatedAt={query.dataUpdatedAt} />

        {showSpinner ? <Skeleton lines={4} /> : null}

        {showError ? (
          <CenteredMessage>
            <Notice tone="danger">
              {online
                ? "We couldn't load your children just now."
                : "You're offline and there's no saved copy yet."}
            </Notice>
            <Button title="Try again" variant="secondary" onPress={() => void query.refetch()} />
          </CenteredMessage>
        ) : null}

        {query.data && students.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No children linked yet"
            body="Your school links your children to your account. Ask the school office if this looks wrong."
          />
        ) : null}

        {students.length > 0 ? <SectionHeader title={students.length === 1 ? "Your child" : "Your children"} /> : null}

        {students.map((student, index) => {
          // Three queries per child, in the order they were declared above.
          const invoices = extras[index * 3]?.data as { data: never[] } | undefined;
          const results = extras[index * 3 + 1]?.data as { data: never[] } | undefined;
          const homework = extras[index * 3 + 2]?.data as
            | { data: { overdue: boolean }[]; dueSoonCount: number }
            | undefined;
          const highlight = childHighlight({
            invoices: invoices?.data,
            results: results?.data,
            homeworkDueSoon: homework?.dueSoonCount ?? 0,
            homeworkOverdue: homework?.data.filter((item) => item.overdue).length ?? 0,
          });
          return (
            <Card key={student.id} style={styles.child}>
              <View style={styles.childHead}>
                <View style={[styles.avatar, { borderColor: colors.primary }]}>
                  <Text style={[styles.avatarText, { color: colors.primary }]}>
                    {initials(student.firstName, student.lastName)}
                  </Text>
                </View>
                <View style={styles.childText}>
                  <Body>{fullName(student)}</Body>
                  <Label>
                    {student.currentEnrollment
                      ? `${student.currentEnrollment.classArm.classLevel.name} · ${student.currentEnrollment.classArm.name}`
                      : "Not currently enrolled"}
                  </Label>
                </View>
              </View>

              {highlight ? (
                <Notice tone={highlight.tone}>{highlight.text}</Notice>
              ) : null}

              <Button
                title={highlight?.kind === "fees" ? "Open and pay" : "Open"}
                variant={highlight?.kind === "fees" ? "primary" : "secondary"}
                onPress={() => router.push(`/students/${student.id}`)}
              />
            </Card>
          );
        })}

        <SectionHeader title="The school" />
        <ListRow
          icon="today-outline"
          title="School calendar"
          subtitle="Holidays, exams and events"
          onPress={() => router.push("/calendar")}
        />
      </ScrollView>

      <AppMenu
        visible={menu.visible}
        onClose={menu.close}
        destinations={guardianDestinations()}
        person={{
          name: guardian ? `${guardian.firstName} ${guardian.lastName}` : "Parent",
          detail: ["Parent", school?.name].filter(Boolean).join(" · "),
        }}
        onSignOut={() => void signOut()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  child: { gap: spacing.sm },
  childHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  childText: { flex: 1, gap: spacing.xs },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
});
