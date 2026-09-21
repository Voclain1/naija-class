import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, TextInput } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";

import { staffListStudents } from "../../../src/lib/api/staff-students";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { isSchoolAdmin } from "../../../src/lib/auth/roles";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import { Button, CenteredMessage, Notice, Screen } from "../../../src/components/ui";
import {
  EmptyState,
  ListRow,
  ScreenHeader,
  Skeleton,
} from "../../../src/components/layout";

// CP4c — the school's students: search, open one, or add one.
//
// Search is SERVER-SIDE, debounced: a school can hold thousands of students,
// and pulling them all to filter on a phone would be slow on a mobile network
// and put every child's record in memory at once. Pages load on demand.

const PAGE_SIZE = 30;

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export default function StudentsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const admin = isSchoolAdmin(staff?.roles);

  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim(), 350);

  const students = useInfiniteQuery({
    queryKey: queryKeys.staffStudents(schoolId, userId, term),
    queryFn: ({ pageParam }) =>
      staffListStudents({
        search: term || undefined,
        cursor: pageParam ?? undefined,
        limit: PAGE_SIZE,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.cursor ?? null,
    enabled: authed && admin && schoolId !== "" && userId !== "",
    staleTime: 30_000,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const rows = (students.data?.pages ?? []).flatMap((page) => page.data);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title="Students"
          action={admin ? <Button title="Add" onPress={() => router.push("/staff/students/new")} /> : null}
        />

        {!admin ? (
          <EmptyState
            icon="lock-closed-outline"
            title="Not available on your account"
            body="Student records are managed by owners and administrators."
          />
        ) : (
          <>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name or admission number"
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              accessibilityLabel="Search students"
              style={[
                styles.search,
                { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
              ]}
            />

            {students.isPending ? <Skeleton lines={6} /> : null}

            {students.isError && !students.data ? (
              <CenteredMessage>
                <Notice tone="danger">We couldn&apos;t load students. Try again shortly.</Notice>
                <Button title="Try again" variant="secondary" onPress={() => void students.refetch()} />
              </CenteredMessage>
            ) : null}

            {students.data && rows.length === 0 ? (
              term ? (
                <EmptyState
                  icon="search-outline"
                  title="No match"
                  body={`No student matches "${term}". Check the spelling or the admission number.`}
                />
              ) : (
                <EmptyState
                  icon="people-outline"
                  title="No students yet"
                  body="Add your first student with the Add button above."
                />
              )
            ) : null}

            {rows.map((student) => (
              <ListRow
                key={student.id}
                icon="person-outline"
                title={[student.firstName, student.lastName].filter(Boolean).join(" ")}
                subtitle={`${student.admissionNumber}${
                  student.currentEnrollment?.classArm.name
                    ? ` · ${student.currentEnrollment.classArm.name}`
                    : " · not placed"
                }${student.status === "ACTIVE" ? "" : ` · ${student.status.toLowerCase()}`}`}
                onPress={() => router.push(`/staff/students/${student.id}`)}
              />
            ))}

            {students.hasNextPage ? (
              <Button
                title="Show more"
                variant="secondary"
                loading={students.isFetchingNextPage}
                disabled={students.isFetchingNextPage}
                onPress={() => void students.fetchNextPage()}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
});
