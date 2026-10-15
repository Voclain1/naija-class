import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HEALTH_LIMITS, type HealthProfileDto, type HealthProfileField } from "@school-kit/types";

import { TextField } from "../../../src/components/form";
import { SickbayCard } from "../../../src/components/sickbay-card";
import { VaccinationsCard } from "../../../src/components/vaccinations-card";
import { ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Button, Caption, Card, Label, Screen } from "../../../src/components/ui";
import { ApiError } from "../../../src/lib/api/client";
import { saveStaffHealthProfile, staffHealthProfile } from "../../../src/lib/api/staff-health";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { useTheme } from "../../../src/theme/theme-provider";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP3.1 — one child's health record in the staff app
// (docs/modules/phase-9.md §10). Owner, admin and the Health officer read it;
// editing needs health.manage. Every open is an audited read on the server.

const FIELDS: { key: HealthProfileField; label: string; multiline: boolean }[] = [
  { key: "allergies", label: "Allergies", multiline: true },
  { key: "conditions", label: "Conditions", multiline: true },
  { key: "medication", label: "Medication", multiline: true },
  { key: "gpClinic", label: "GP or clinic", multiline: false },
  { key: "emergencyNotes", label: "Emergency notes", multiline: true },
  { key: "bloodGroup", label: "Blood group", multiline: false },
];

type Values = Record<HealthProfileField, string>;

function valuesOf(p: HealthProfileDto): Values {
  return {
    allergies: p.allergies ?? "",
    conditions: p.conditions ?? "",
    medication: p.medication ?? "",
    gpClinic: p.gpClinic ?? "",
    emergencyNotes: p.emergencyNotes ?? "",
    bloodGroup: p.bloodGroup ?? "",
    teacherNote: p.teacherNote ?? "",
  };
}

export default function HealthRecordScreen() {
  const { studentId } = useLocalSearchParams<{ studentId: string }>();
  const id = typeof studentId === "string" ? studentId : "";
  const { status, principal, staff } = useSession();
  const { colors } = useTheme();
  const authed = status === "authenticated" && principal === "staff";
  const canEdit = hasPermission(staff?.permissions ?? [], "health.manage");
  const canSickbay = hasPermission(staff?.permissions ?? [], "sickbay.manage");
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const queryClient = useQueryClient();
  const key = queryKeys.staffHealthProfile(schoolId, userId, id);
  const [values, setValues] = useState<Values | null>(null);

  const profile = useQuery({ queryKey: key, queryFn: () => staffHealthProfile(id), enabled: authed && id !== "" });

  const save = useMutation({
    mutationFn: (v: Values) => saveStaffHealthProfile(id, v),
    onSuccess: (saved) => {
      queryClient.setQueryData(key, saved);
      void queryClient.invalidateQueries({ queryKey: ["staff", schoolId, userId, "health-list"] });
      setValues(null);
    },
    onError: (e) =>
      Alert.alert("Not saved", e instanceof ApiError ? e.message : "We couldn't save that. Check your connection and try again."),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const p = profile.data;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title={p?.studentName ?? "Health record"}
            subtitle={p ? `${p.admissionNumber}${p.className ? ` · ${p.className}` : ""}` : null}
          />
          <Caption>
            The owner, admins, the health officer and the child&apos;s parents see the whole record. Teachers of the
            child see only the note for teachers.
          </Caption>
          {profile.isLoading ? (
            <Skeleton lines={4} />
          ) : profile.isError ? (
            <LoadError error={profile.error} what="this health record" onRetry={() => void profile.refetch()} />
          ) : p && values ? (
            <Card>
              {FIELDS.map((f) => (
                <TextField
                  key={f.key}
                  label={f.label}
                  value={values[f.key]}
                  onChangeText={(text) => setValues({ ...values, [f.key]: text })}
                  multiline={f.multiline}
                  maxLength={HEALTH_LIMITS[f.key]}
                  autoCapitalize="sentences"
                />
              ))}
              <View style={[styles.teacherBox, { backgroundColor: `${colors.secondary}1A` }]}>
                <TextField
                  label="For teachers (the only part teachers see)"
                  value={values.teacherNote}
                  onChangeText={(text) => setValues({ ...values, teacherNote: text })}
                  multiline
                  maxLength={HEALTH_LIMITS.teacherNote}
                  autoCapitalize="sentences"
                />
              </View>
              <View style={styles.buttons}>
                <Button title="Save" loading={save.isPending} onPress={() => save.mutate(values)} />
                <Button title="Cancel" variant="secondary" disabled={save.isPending} onPress={() => setValues(null)} />
              </View>
            </Card>
          ) : p ? (
            <Card>
              {p.updatedAt === null ? (
                <Body muted>Nothing recorded yet.</Body>
              ) : (
                FIELDS.map((f) => (
                  <View key={f.key} style={styles.row}>
                    <Label>{f.label}</Label>
                    <Body>{p[f.key] ?? "—"}</Body>
                  </View>
                ))
              )}
              <View style={[styles.teacherBox, { backgroundColor: `${colors.secondary}1A` }]}>
                <Label>For teachers</Label>
                <Body>{p.teacherNote ?? "Nothing shared with teachers."}</Body>
              </View>
              {p.updatedAt ? (
                <Caption>
                  Last changed by {p.updatedByName ?? "staff"} on{" "}
                  {new Date(p.updatedAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                </Caption>
              ) : null}
              {canEdit ? (
                <Button
                  title={p.updatedAt === null ? "Add health record" : "Edit health record"}
                  variant="secondary"
                  onPress={() => setValues(valuesOf(p))}
                />
              ) : null}
            </Card>
          ) : null}
          {/* Phase 9 / CP3.2: vaccinations, with an optional document each. */}
          {p && !values ? (
            <VaccinationsCard profile={p} canEdit={canEdit} onChanged={(next) => queryClient.setQueryData(key, next)} />
          ) : null}
          {/* Phase 9 / CP3.3: the sickbay log, for sickbay.manage only. */}
          {p && !values && canSickbay ? <SickbayCard schoolId={schoolId} userId={userId} studentId={id} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, paddingVertical: spacing.md },
  row: { gap: spacing.xs },
  teacherBox: { gap: spacing.xs, padding: spacing.sm, borderRadius: 8 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
