import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BEHAVIOUR_INCIDENT_MAX_STUDENTS,
  BEHAVIOUR_INCIDENT_MAX_WITNESSES,
  BEHAVIOUR_INCIDENT_PLACE_MAX,
  BEHAVIOUR_NOTE_MAX,
} from "@school-kit/types";

import { signedPoints } from "../../../../src/components/behaviour-card";
import { ChoiceChips, TextField } from "../../../../src/components/form";
import { ScreenHeader, Skeleton } from "../../../../src/components/layout";
import { LoadError } from "../../../../src/components/load-error";
import { Body, Button, Caption, Card, Heading, Notice, Screen } from "../../../../src/components/ui";
import { ApiError } from "../../../../src/lib/api/client";
import {
  createStaffIncident,
  staffBehaviourSettings,
  staffIncidentOptions,
  staffIncidentRoster,
} from "../../../../src/lib/api/staff-behaviour";
import { hasPermission } from "../../../../src/lib/auth/permissions";
import { useSession } from "../../../../src/lib/auth/session";
import { queryKeys } from "../../../../src/lib/query/keys";
import { serverToday } from "../../../../src/lib/staff/server-date";
import { useTheme } from "../../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../../src/theme/tokens";

// Recording an incident from a class (docs/modules/phase-9.md §9 CP2-D2).
//
// One incident, several students from this class; each gets a concern on
// their own record. The roster and staff list come from the API already
// narrowed to what this person may name. Notes per student, and naming
// students from several classes at once, are on the website; here the
// incident's description is every student's note.
//
// C14: staff only. C15: no AI.

const NO_CATEGORY = "none";

function CheckRow({ label, checked, disabled, onPress }: { label: string; checked: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      onPress={disabled ? undefined : onPress}
      style={[styles.check, { borderColor: colors.border, opacity: disabled ? 0.5 : 1 }]}
    >
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={colors.primary} />
      <Text style={[styles.checkText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

export default function RecordIncidentScreen() {
  const { armId, armName } = useLocalSearchParams<{ armId: string; armName?: string }>();
  const { status, principal, staff } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const canWrite = hasPermission(staff?.permissions ?? [], "behaviour.create");
  const ready = authed && canWrite && schoolId !== "" && userId !== "" && !!armId;

  const [place, setPlace] = useState("");
  const [description, setDescription] = useState("");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [witnessIds, setWitnessIds] = useState<string[]>([]);
  const [showStaff, setShowStaff] = useState(false);
  const [categoryId, setCategoryId] = useState<string>(NO_CATEGORY);

  const roster = useQuery({
    queryKey: queryKeys.staffIncidentRoster(schoolId, userId, armId ?? ""),
    queryFn: () => staffIncidentRoster(armId ?? ""),
    enabled: ready,
    staleTime: 60_000,
  });
  const options = useQuery({
    queryKey: queryKeys.staffIncidentOptions(schoolId, userId),
    queryFn: staffIncidentOptions,
    enabled: ready,
    staleTime: 5 * 60_000,
  });
  const settings = useQuery({
    queryKey: queryKeys.staffBehaviourSettings(schoolId, userId),
    queryFn: staffBehaviourSettings,
    enabled: ready,
    staleTime: 5 * 60_000,
  });

  const occurredOn = serverToday() ?? new Date().toISOString().slice(0, 10);
  const concernCategories = settings.data?.pointsEnabled
    ? settings.data.categories.filter((c) => c.active && c.kind === "CONCERN")
    : [];

  const save = useMutation({
    mutationFn: () =>
      createStaffIncident({
        occurredOn,
        place: place.trim(),
        description: description.trim(),
        students: studentIds.map((studentId) => ({ studentId })),
        witnessIds,
        ...(categoryId !== NO_CATEGORY ? { categoryId } : {}),
      }),
    onSuccess: () => {
      // Each student's behaviour list now has a new concern.
      void queryClient.invalidateQueries({ queryKey: ["staff", schoolId, userId, "behaviour"] });
      Alert.alert("Incident recorded", "Each student has a concern on their record.");
      router.back();
    },
    onError: (error: unknown) =>
      Alert.alert(
        "Not saved",
        error instanceof ApiError && error.status < 500 ? error.message : "We couldn't save that. Check your connection and try again.",
      ),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  const valid = place.trim() !== "" && description.trim() !== "" && studentIds.length > 0;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Record an incident" subtitle={armName || null} />
        <Caption>Staff only: parents and students never see this.</Caption>

        {!canWrite ? (
          <Notice tone="info">Your account can&apos;t record behaviour.</Notice>
        ) : (
          <>
            <Card>
              <TextField
                label="Where"
                value={place}
                onChangeText={setPlace}
                maxLength={BEHAVIOUR_INCIDENT_PLACE_MAX}
                placeholder="For example, Playground"
                autoCapitalize="sentences"
              />
              <TextField
                label="What happened"
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={BEHAVIOUR_NOTE_MAX}
                placeholder="Write it as you would say it to a colleague."
                autoCapitalize="sentences"
              />
              <Caption>Recorded as happening today. Each student gets this as a concern on their record.</Caption>
            </Card>

            <Card>
              <Heading>Students involved</Heading>
              {roster.isPending ? (
                <Skeleton lines={4} />
              ) : roster.isError && !roster.data ? (
                <LoadError error={roster.error} what="this class" onRetry={() => void roster.refetch()} />
              ) : (roster.data?.students.length ?? 0) === 0 ? (
                <Body muted>No students are enrolled in this class this term.</Body>
              ) : (
                roster.data!.students.map((student) => (
                  <CheckRow
                    key={student.studentId}
                    label={student.name}
                    checked={studentIds.includes(student.studentId)}
                    disabled={
                      studentIds.length >= BEHAVIOUR_INCIDENT_MAX_STUDENTS && !studentIds.includes(student.studentId)
                    }
                    onPress={() => setStudentIds((ids) => toggle(ids, student.studentId))}
                  />
                ))
              )}
              {studentIds.length > 0 ? (
                <Caption>
                  {studentIds.length} student{studentIds.length === 1 ? "" : "s"} chosen
                </Caption>
              ) : null}
            </Card>

            {(options.data?.staff.length ?? 0) > 0 ? (
              <Card>
                <Heading>Staff who saw it</Heading>
                {witnessIds.length > 0 ? (
                  <Caption>
                    {options.data!.staff
                      .filter((m) => witnessIds.includes(m.userId))
                      .map((m) => m.name)
                      .join(", ")}
                  </Caption>
                ) : (
                  <Caption>Optional.</Caption>
                )}
                {showStaff ? (
                  options.data!.staff.map((member) => (
                    <CheckRow
                      key={member.userId}
                      label={member.name}
                      checked={witnessIds.includes(member.userId)}
                      disabled={
                        witnessIds.length >= BEHAVIOUR_INCIDENT_MAX_WITNESSES && !witnessIds.includes(member.userId)
                      }
                      onPress={() => setWitnessIds((ids) => toggle(ids, member.userId))}
                    />
                  ))
                ) : (
                  <Button title="Choose staff" variant="secondary" onPress={() => setShowStaff(true)} />
                )}
              </Card>
            ) : null}

            {concernCategories.length > 0 ? (
              <Card>
                <ChoiceChips
                  label="Category for every student"
                  options={[
                    { value: NO_CATEGORY, label: "No category" },
                    ...concernCategories.map((c) => ({ value: c.id, label: `${c.name} (${signedPoints(c.points)})` })),
                  ]}
                  value={categoryId}
                  onChange={setCategoryId}
                />
              </Card>
            ) : null}

            <View style={styles.actions}>
              <Button
                title={save.isPending ? "Saving…" : "Save incident"}
                onPress={() => save.mutate()}
                disabled={!valid || save.isPending}
              />
              {!valid ? <Caption>Say where it happened, what happened, and choose at least one student.</Caption> : null}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  check: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: spacing.xs,
    minHeight: 44,
  },
  checkText: { flex: 1, fontFamily: fonts.sans, fontSize: fontSizes.body },
  actions: { gap: spacing.sm },
});
