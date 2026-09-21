import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GuardianRosterRowDto, RelationshipDto } from "@school-kit/types";

import {
  staffCreateAndLinkGuardian,
  staffLinkGuardian,
  staffSearchGuardians,
} from "../../../src/lib/api/staff-guardians";
import { staffGetStudent } from "../../../src/lib/api/staff-students";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import {
  RELATIONSHIP_OPTIONS,
  buildCreateParentInput,
  emptyParentForm,
  parentAbilities,
  validateParentForm,
  type NewParentErrors,
  type NewParentValues,
} from "../../../src/lib/staff/guardian-form";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, Label, Notice, Screen } from "../../../src/components/ui";
import { EmptyState, ListRow, ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";
import { ChoiceChips, TextField } from "../../../src/components/form";

// CP9a — link a parent to a child.
//
// Search FIRST, then add. Siblings share parents, and a second record for the
// same mother means two portal accounts, two sets of fee messages and a
// "which one is real?" call to the school. So the screen opens on a search of
// the parents the school already has, and "Add a new parent" is the fallback,
// not the default.

type Mode = "search" | "new";

function describeFailure(error: unknown): string {
  if (error instanceof ApiNetworkError) {
    return "Your phone couldn't reach the server. Nothing was saved — try again when you have signal.";
  }
  if (error instanceof ApiError) {
    if (error.code === "GUARDIAN_ALREADY_LINKED") return "This parent is already linked to this child.";
    if (error.code === "GUARDIAN_EMAIL_ALREADY_EXISTS") {
      return "Another parent at this school already uses that email. Search for them instead of adding a new record.";
    }
    return error.message || "That couldn't be saved.";
  }
  return "That couldn't be saved.";
}

export default function LinkParentScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { studentId } = useLocalSearchParams<{ studentId: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const abilities = parentAbilities(staff?.roles, staff?.permissions ?? []);
  const studentKey = queryKeys.staffStudent(schoolId, userId, studentId ?? "");

  const student = useQuery({
    queryKey: studentKey,
    queryFn: () => staffGetStudent(studentId as string),
    enabled: authed && abilities.link && !!studentId && schoolId !== "",
    staleTime: 30_000,
  });

  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [values, setValues] = useState<NewParentValues | null>(null);
  const [errors, setErrors] = useState<NewParentErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const results = useQuery({
    queryKey: queryKeys.staffGuardianSearch(schoolId, userId, submitted),
    queryFn: () => staffSearchGuardians(submitted),
    enabled: authed && abilities.link && submitted.length >= 2,
    staleTime: 30_000,
  });

  async function done(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: studentKey }),
      queryClient.invalidateQueries({ queryKey: ["staff", schoolId, userId, "guardians"] }),
    ]);
    router.back();
  }

  const link = useMutation({
    mutationFn: (args: { guardianId: string; isPrimary: boolean }) =>
      staffLinkGuardian(studentId as string, { guardianId: args.guardianId, isPrimary: args.isPrimary }),
    onMutate: () => setFailure(null),
    onSuccess: done,
    onError: (error) => setFailure(describeFailure(error)),
  });

  const create = useMutation({
    mutationFn: (input: NewParentValues) => staffCreateAndLinkGuardian(studentId as string, buildCreateParentInput(input)),
    onMutate: () => setFailure(null),
    onSuccess: done,
    onError: (error) => setFailure(describeFailure(error)),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (!abilities.link) {
    return (
      <Screen>
        {header}
        <Notice tone="info">Parents are linked by owners and administrators.</Notice>
      </Screen>
    );
  }

  if (student.isPending) {
    return (
      <Screen>
        {header}
        <Skeleton lines={5} />
      </Screen>
    );
  }

  const child = student.data;
  const childName = child ? child.firstName : "this child";
  const existingParents = child?.guardians.length ?? 0;
  const linkedIds = new Set((child?.guardians ?? []).map((g) => g.id));
  const busy = link.isPending || create.isPending;

  function confirmLink(guardian: GuardianRosterRowDto): void {
    const isPrimary = existingParents === 0;
    Alert.alert(
      `Link ${guardian.firstName} ${guardian.lastName}?`,
      `They will be linked to ${childName}${isPrimary ? " as the main contact" : ""}, and will see ${childName} in the parent app if they use it.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Link", onPress: () => link.mutate({ guardianId: guardian.id, isPrimary }) },
      ],
    );
  }

  function startNew(): void {
    setValues(emptyParentForm(existingParents));
    setErrors({});
    setMode("new");
  }

  function saveNew(): void {
    if (!values) return;
    const found = validateParentForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    create.mutate(values);
  }

  const rows = results.data?.data ?? [];

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title={`A parent for ${childName}`}
            subtitle={mode === "search" ? "Find them first — they may already be a parent here." : "A parent the school doesn't have yet."}
          />

          {failure ? <Notice tone="danger">{failure}</Notice> : null}

          {mode === "search" ? (
            <>
              <Card style={styles.card}>
                <TextField
                  label="Name or phone number"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="e.g. Okafor or 0803…"
                />
                <Button
                  title="Search"
                  disabled={query.trim().length < 2}
                  onPress={() => setSubmitted(query.trim())}
                />
              </Card>

              {results.isFetching ? <Skeleton lines={3} /> : null}
              {results.isError ? <Notice tone="danger">We couldn&apos;t search just now. Try again.</Notice> : null}

              {submitted !== "" && results.data && rows.length === 0 ? (
                <EmptyState
                  icon="search-outline"
                  title="No parent found"
                  body={`Nobody at the school matches "${submitted}". Add them as a new parent below.`}
                />
              ) : null}

              {rows.length > 0 ? <SectionHeader title="Parents at the school" note={`${rows.length}`} /> : null}
              {rows.map((guardian) => {
                const already = linkedIds.has(guardian.id);
                const children = guardian.children.map((c) => c.firstName).join(", ");
                return (
                  <ListRow
                    key={guardian.id}
                    icon={already ? "checkmark-circle-outline" : "person-add-outline"}
                    title={`${guardian.firstName} ${guardian.lastName}`}
                    subtitle={[guardian.phone, children ? `parent of ${children}` : null, already ? "already linked" : null]
                      .filter(Boolean)
                      .join(" · ")}
                    onPress={already || busy ? undefined : () => confirmLink(guardian)}
                  />
                );
              })}

              <Button title="Add a new parent" variant="secondary" onPress={startNew} />
            </>
          ) : values ? (
            <>
              <Card style={styles.card}>
                <TextField
                  label="First name"
                  value={values.firstName}
                  onChangeText={(firstName) => setValues({ ...values, firstName })}
                  error={errors.firstName}
                  autoCapitalize="words"
                />
                <TextField
                  label="Surname"
                  value={values.lastName}
                  onChangeText={(lastName) => setValues({ ...values, lastName })}
                  error={errors.lastName}
                  autoCapitalize="words"
                />
                <ChoiceChips<RelationshipDto>
                  label={`Relationship to ${childName}`}
                  options={RELATIONSHIP_OPTIONS}
                  value={values.relationship}
                  onChange={(relationship) => setValues({ ...values, relationship })}
                  error={errors.relationship}
                />
                <TextField
                  label="Phone"
                  value={values.phone}
                  onChangeText={(phone) => setValues({ ...values, phone })}
                  error={errors.phone}
                  keyboardType="phone-pad"
                />
                <TextField
                  label="Email (optional — needed for the parent app)"
                  value={values.email}
                  onChangeText={(email) => setValues({ ...values, email })}
                  error={errors.email}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <ChoiceChips<"yes" | "no">
                  label="Main contact for this child?"
                  options={[
                    { value: "yes", label: "Yes" },
                    { value: "no", label: "No" },
                  ]}
                  value={values.isPrimary ? "yes" : "no"}
                  onChange={(answer) => setValues({ ...values, isPrimary: answer === "yes" })}
                />
                {values.isPrimary && existingParents > 0 ? (
                  <Label>The current main contact will stop being the main contact.</Label>
                ) : null}
              </Card>
              <Button title="Add and link" loading={create.isPending} disabled={busy} onPress={saveNew} />
              <Button title="Back to search" variant="secondary" disabled={busy} onPress={() => setMode("search")} />
              <Body muted>You can invite them to the parent app from their page afterwards.</Body>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  card: { gap: spacing.md },
});
