import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GenderDto } from "@school-kit/types";

import { staffClassArms, staffCreateStudent } from "../../../src/lib/api/staff-students";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { isSchoolAdmin } from "../../../src/lib/auth/roles";
import { serverToday } from "../../../src/lib/staff/server-date";
import { useTermContext } from "../../../src/lib/staff/use-term-context";
import {
  EMPTY_STUDENT_FORM,
  buildCreateStudentInput,
  validateStudentForm,
  type Placement,
  type StudentFormErrors,
  type StudentFormValues,
} from "../../../src/lib/staff/student-form";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, Label, Notice, Screen } from "../../../src/components/ui";
import { ScreenHeader, SectionHeader } from "../../../src/components/layout";

// CP4c — add a student from the phone.
//
// Two rules from student-form.ts are the reason this screen looks the way it
// does:
//
//  - CLASS PLACEMENT STARTS UNANSWERED. There is no pre-selected class, and
//    none is guessed. The admin picks a class or taps "Place later"; until one
//    of those is chosen, Save stays disabled. A pre-ticked default is what
//    enrolled an entire school wrongly on 2026-08-25.
//  - DATE OF BIRTH IS THREE NUMBER BOXES — day, month, year — not a calendar
//    picker, which is much harder to use for a year a decade back.
//
// Only the essentials are asked for here. Everything else on a student's
// record (medical notes, religion, state of origin) can be added from their
// page afterwards, so adding a child at the gate stays a one-minute job.

const GENDERS: { value: GenderDto; label: string }[] = [
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
  { value: "OTHER", label: "Other" },
];

function describeFailure(error: unknown): string {
  if (error instanceof ApiNetworkError) {
    return "Your phone couldn't reach the server. The student was not added — try again when you have signal.";
  }
  if (error instanceof Error && error.message === "NO_CURRENT_TERM") {
    return "There is no current term to place the student in. Choose \"Place later\", or set the current term on the website.";
  }
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return "That admission number is already in use. Check it, or use the next number.";
    }
    return error.message || "The student could not be added.";
  }
  return "The student could not be added.";
}

export default function NewStudentScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const admin = isSchoolAdmin(staff?.roles);
  const ready = authed && admin && schoolId !== "" && userId !== "";

  const arms = useQuery({
    queryKey: queryKeys.staffClassArms(schoolId, userId),
    queryFn: staffClassArms,
    enabled: ready,
    staleTime: 5 * 60_000,
  });
  const termContext = useTermContext({ schoolId, userId, enabled: ready });
  const termId = termContext.data?.term?.termId ?? null;

  const [values, setValues] = useState<StudentFormValues>(EMPTY_STUDENT_FORM);
  const [placement, setPlacement] = useState<Placement>({ kind: "unanswered" });
  const [errors, setErrors] = useState<StudentFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const set = (field: keyof StudentFormValues) => (text: string) =>
    setValues((current) => ({ ...current, [field]: text }));

  const create = useMutation({
    mutationFn: () => staffCreateStudent(buildCreateStudentInput(values, placement, termId)),
    onMutate: () => setFailure(null),
    onSuccess: async (student) => {
      await queryClient.invalidateQueries({ queryKey: ["staff", schoolId, userId, "students"] });
      router.replace(`/staff/students/${student.id}`);
    },
    onError: (error: unknown) => setFailure(describeFailure(error)),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  function save(): void {
    const found = validateStudentForm(values, placement, serverToday());
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    create.mutate();
  }

  function field(
    label: string,
    key: keyof StudentFormValues,
    options: { error?: string; keyboardType?: "default" | "phone-pad"; multiline?: boolean } = {},
  ) {
    return (
      <View style={styles.field}>
        <Label>{label}</Label>
        <TextInput
          value={values[key] as string}
          onChangeText={set(key)}
          keyboardType={options.keyboardType ?? "default"}
          multiline={options.multiline}
          accessibilityLabel={label}
          style={[
            options.multiline ? styles.textarea : styles.input,
            {
              color: colors.foreground,
              backgroundColor: colors.card,
              borderColor: options.error ? colors.danger : colors.border,
            },
          ]}
        />
        {options.error ? <Text style={[styles.error, { color: colors.danger }]}>{options.error}</Text> : null}
      </View>
    );
  }

  function dobBox(key: "dobDay" | "dobMonth" | "dobYear", placeholder: string, width: number) {
    return (
      <TextInput
        value={values[key]}
        onChangeText={(text) => set(key)(text.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        maxLength={key === "dobYear" ? 4 : 2}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel={`Date of birth, ${placeholder.toLowerCase()}`}
        style={[
          styles.input,
          styles.dobBox,
          {
            width,
            color: colors.foreground,
            backgroundColor: colors.card,
            borderColor: errors.dateOfBirth ? colors.danger : colors.border,
          },
        ]}
      />
    );
  }

  if (!admin) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
        <Notice tone="info">Student records are managed by owners and administrators.</Notice>
      </Screen>
    );
  }

  const activeArms = (arms.data ?? []).filter((arm) => arm.isActive);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader title="Add a student" subtitle="The essentials now; the rest from their page later." />

          <Card style={styles.card}>
            {field("Admission number", "admissionNumber", { error: errors.admissionNumber })}
            {field("First name", "firstName", { error: errors.firstName })}
            {field("Middle name (optional)", "middleName")}
            {field("Surname", "lastName", { error: errors.lastName })}

            <View style={styles.field}>
              <Label>Date of birth</Label>
              <View style={styles.dobRow}>
                {dobBox("dobDay", "Day", 64)}
                {dobBox("dobMonth", "Month", 72)}
                {dobBox("dobYear", "Year", 92)}
              </View>
              {errors.dateOfBirth ? (
                <Text style={[styles.error, { color: colors.danger }]}>{errors.dateOfBirth}</Text>
              ) : null}
            </View>

            <View style={styles.field}>
              <Label>Gender</Label>
              <View style={styles.chips}>
                {GENDERS.map((gender) => {
                  const active = values.gender === gender.value;
                  return (
                    <Pressable
                      key={gender.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setValues((current) => ({ ...current, gender: gender.value }))}
                      style={[
                        styles.chip,
                        { borderColor: colors.primary, backgroundColor: active ? colors.primary : "transparent" },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.primary }]}>
                        {gender.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {errors.gender ? <Text style={[styles.error, { color: colors.danger }]}>{errors.gender}</Text> : null}
            </View>

            {field("Parent's phone (optional)", "phone", { keyboardType: "phone-pad" })}
            {field("Home address (optional)", "address", { multiline: true })}
          </Card>

          <SectionHeader title="Class" />
          <Card style={styles.card}>
            {/* No pre-selected class. The admin must answer (student-form.ts). */}
            <Body muted>
              {termContext.data?.term
                ? `Place the student in a class for ${termContext.data.term.termName}, or place them later.`
                : "There is no current term, so the student can only be placed later."}
            </Body>
            <View style={styles.chips}>
              {termContext.data?.term
                ? activeArms.map((arm) => {
                    const active = placement.kind === "arm" && placement.classArmId === arm.id;
                    return (
                      <Pressable
                        key={arm.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => setPlacement({ kind: "arm", classArmId: arm.id })}
                        style={[
                          styles.chip,
                          { borderColor: colors.primary, backgroundColor: active ? colors.primary : "transparent" },
                        ]}
                      >
                        <Text
                          style={[styles.chipText, { color: active ? colors.primaryForeground : colors.primary }]}
                        >
                          {arm.name}
                        </Text>
                      </Pressable>
                    );
                  })
                : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: placement.kind === "later" }}
                onPress={() => setPlacement({ kind: "later" })}
                style={[
                  styles.chip,
                  {
                    borderColor: colors.mutedForeground,
                    backgroundColor: placement.kind === "later" ? colors.mutedForeground : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: placement.kind === "later" ? colors.background : colors.mutedForeground },
                  ]}
                >
                  Place later
                </Text>
              </Pressable>
            </View>
            {errors.placement ? (
              <Text style={[styles.error, { color: colors.danger }]}>{errors.placement}</Text>
            ) : null}
          </Card>

          {failure ? <Notice tone="danger">{failure}</Notice> : null}

          <Button
            title="Add student"
            loading={create.isPending}
            disabled={create.isPending || placement.kind === "unanswered"}
            onPress={save}
          />
          {placement.kind === "unanswered" ? (
            <Label>Choose a class or &quot;Place later&quot; to continue.</Label>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  card: { gap: spacing.md },
  field: { gap: spacing.xs },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  textarea: {
    minHeight: 80,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    textAlignVertical: "top",
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  dobRow: { flexDirection: "row", gap: spacing.sm },
  dobBox: { textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: "center",
  },
  chipText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  error: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
});
