import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { ChoiceChips, TextField } from "../../../src/components/form";
import { ListRow, ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Button, Caption, Card, Notice, Screen } from "../../../src/components/ui";
import { staffHealthList } from "../../../src/lib/api/staff-health";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP3.1 — the Health list (docs/modules/phase-9.md §10): the
// Health officer's home in the app, and a way in for owner and admin. Names
// and flags only; the record opens on the child's own screen.
const ALL = "all";

export default function HealthListScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canRead = hasPermission(staff?.permissions ?? [], "health.read");
  // CP11.2: the sickbay's visits a day at a time.
  const canSickbay = hasPermission(staff?.permissions ?? [], "sickbay.manage");
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [armId, setArmId] = useState<string>(ALL);

  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const list = useQuery({
    queryKey: queryKeys.staffHealthList(schoolId, userId, q, armId),
    queryFn: () => staffHealthList({ ...(q ? { q } : {}), ...(armId !== ALL ? { armId } : {}) }),
    enabled: authed && canRead,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const arms = list.data?.arms ?? [];
  const students = list.data?.data ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
      >
        <ScreenHeader title="Health" subtitle="Students' health records" />
        {canSickbay ? <Button variant="secondary" title="Sickbay visits by day" onPress={() => router.push("/staff/health/sickbay")} /> : null}
        {!canRead ? (
          <Notice tone="info">Your account can&apos;t see health records.</Notice>
        ) : (
          <>
            <TextField label="Search" value={typed} onChangeText={setTyped} placeholder="Name or admission number" />
            {arms.length > 0 ? (
              <ChoiceChips<string>
                label="Class"
                options={[{ value: ALL, label: "All classes" }, ...arms.map((a) => ({ value: a.id, label: a.name }))]}
                value={armId}
                onChange={setArmId}
              />
            ) : null}
            {list.isLoading ? (
              <Skeleton lines={4} />
            ) : list.isError ? (
              <LoadError error={list.error} what="students" onRetry={() => void list.refetch()} />
            ) : students.length === 0 ? (
              <Card>
                <Body muted>No students found.</Body>
              </Card>
            ) : (
              students.map((s) => (
                <ListRow
                  key={s.studentId}
                  title={s.name}
                  subtitle={`${s.admissionNumber}${s.className ? ` · ${s.className}` : ""} · ${
                    !s.hasProfile ? "Nothing recorded" : s.hasTeacherNote ? "Recorded · note for teachers" : "Recorded"
                  }`}
                  onPress={() =>
                    router.push({ pathname: "/staff/health/[studentId]", params: { studentId: s.studentId } })
                  }
                />
              ))
            )}
            {students.length === 100 ? <Caption>Showing the first 100. Search or pick a class to narrow it.</Caption> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
});
