import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";

import { BehaviourCard } from "../../../../src/components/behaviour-card";
import { DisciplineCard } from "../../../../src/components/discipline-card";
import { ScreenHeader } from "../../../../src/components/layout";
import { Caption, Notice, Screen } from "../../../../src/components/ui";
import { hasPermission } from "../../../../src/lib/auth/permissions";
import { useSession } from "../../../../src/lib/auth/session";
import { spacing } from "../../../../src/theme/tokens";

// A child's conduct records, for a teacher of their class (pre-build audit,
// 2026-10-13). The API has let teachers write and read these since #351 —
// "the judgement of the person who was in the room" — but the only screen was
// the admin's student record, which a teacher cannot open. Reached from the
// teacher's own class list, which passes the name; the API itself refuses a
// child the teacher does not teach.
export default function TeacherBehaviourScreen() {
  const { studentId, name } = useLocalSearchParams<{ studentId: string; name?: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canRead = hasPermission(staff?.permissions ?? [], "behaviour.read");

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title={name || "Behaviour"} subtitle="Behaviour records" />
        <Caption>Staff only: parents and students never see these, except an approved suspension or exclusion.</Caption>
        {canRead ? (
          <>
            <BehaviourCard
              studentId={studentId ?? ""}
              schoolId={staff?.school.id ?? ""}
              userId={staff?.user.id ?? ""}
              enabled={(studentId ?? "") !== ""}
            />
            {/* Phase 9 / CP2.3: propose a discipline action for this child. */}
            <DisciplineCard
              studentId={studentId ?? ""}
              schoolId={staff?.school.id ?? ""}
              userId={staff?.user.id ?? ""}
              enabled={(studentId ?? "") !== ""}
            />
          </>
        ) : (
          <Notice tone="info">Your account can&apos;t see behaviour records.</Notice>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
});
