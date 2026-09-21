import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateStudentInput } from "@school-kit/types";

import {
  staffClassArms,
  staffGetStudent,
  staffGraduateStudent,
  staffUpdateStudent,
  staffWithdrawStudent,
} from "../../../src/lib/api/staff-students";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { isSchoolAdmin } from "../../../src/lib/auth/roles";
import { webUrl } from "../../../src/lib/web-handoff";
import { staffEnrollStudent } from "../../../src/lib/api/staff-guardians";
import { useTermContext } from "../../../src/lib/staff/use-term-context";
import { describePortalStatus, needsPlacement, parentAbilities } from "../../../src/lib/staff/guardian-form";
import { ChoiceChips } from "../../../src/components/form";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, CenteredMessage, Label, Notice, Screen } from "../../../src/components/ui";
import { ListRow, ScreenHeader, SectionHeader, Skeleton, StatRow } from "../../../src/components/layout";

// CP4c — one student.
//
// What an administrator actually does from a phone: look a child up, fix a
// phone number or an address, and — at the end of a term — withdraw or
// graduate them. The full record editor (medical notes, religion, state of
// origin) stays on the website, reached by a link, because a
// long form is exactly where a phone makes mistakes easy.
//
// CP9a adds the two jobs that used to send the admin to the website: placing
// a child who has no class this term, and linking and inviting their parents.
//
// Withdraw and graduate are confirmed: both remove a child from the active
// roll, and graduate is not something a school expects to undo.

function formatDate(value: string | Date | null): string {
  if (!value) return "—";
  const iso = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const parsed = Date.parse(iso + "T00:00:00.000Z");
  return Number.isNaN(parsed)
    ? "—"
    : new Date(parsed).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function describeFailure(error: unknown): string {
  if (error instanceof ApiNetworkError) {
    return "Your phone couldn't reach the server. Nothing changed — try again when you have signal.";
  }
  if (error instanceof ApiError) {
    if (error.code === "ENROLLMENT_ALREADY_EXISTS") return "This student already has a class this term.";
    if (error.code === "INACTIVE_CLASS_ARM") return "That class is closed. Choose another.";
    return error.message || "That couldn't be saved.";
  }
  return "That couldn't be saved.";
}

export default function StudentScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const admin = isSchoolAdmin(staff?.roles);
  const key = queryKeys.staffStudent(schoolId, userId, id ?? "");
  const router = useRouter();
  const abilities = parentAbilities(staff?.roles, staff?.permissions ?? []);
  const termContext = useTermContext({ schoolId, userId, enabled: authed && abilities.place });
  const currentTerm = termContext.data?.term ?? null;
  const arms = useQuery({
    queryKey: queryKeys.staffClassArms(schoolId, userId),
    queryFn: () => staffClassArms(),
    enabled: authed && abilities.place && schoolId !== "",
    staleTime: 5 * 60_000,
  });
  const [placeArmId, setPlaceArmId] = useState<string | null>(null);

  const student = useQuery({
    queryKey: key,
    queryFn: () => staffGetStudent(id as string),
    enabled: authed && admin && schoolId !== "" && userId !== "" && !!id,
    staleTime: 30_000,
  });

  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ["staff", schoolId, userId, "students"] }),
    ]);
  }

  const update = useMutation({
    mutationFn: (input: UpdateStudentInput) => staffUpdateStudent(id as string, input),
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: async () => {
      setEditing(false);
      setNotice("Saved.");
      await refresh();
    },
    onError: (error: unknown) => setFailure(describeFailure(error)),
  });

  const place = useMutation({
    mutationFn: (classArmId: string) =>
      staffEnrollStudent({ studentId: id as string, termId: currentTerm!.termId, classArmId }),
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: async () => {
      setPlaceArmId(null);
      setNotice("Placed in the class.");
      await refresh();
    },
    onError: (error: unknown) => setFailure(describeFailure(error)),
  });

  const leave = useMutation({
    mutationFn: (kind: "withdraw" | "graduate") =>
      kind === "withdraw"
        ? staffWithdrawStudent(id as string, {})
        : staffGraduateStudent(id as string, {}),
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: async (_result, kind) => {
      setNotice(kind === "withdraw" ? "Withdrawn from the school." : "Marked as graduated.");
      await refresh();
    },
    onError: (error: unknown) => setFailure(describeFailure(error)),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (!admin) {
    return (
      <Screen>
        {header}
        <Notice tone="info">Student records are managed by owners and administrators.</Notice>
      </Screen>
    );
  }

  if (student.isPending) {
    return (
      <Screen>
        {header}
        <Skeleton lines={6} />
      </Screen>
    );
  }

  if (student.isError || !student.data) {
    const notFound = student.error instanceof ApiError && student.error.status === 404;
    return (
      <Screen>
        {header}
        <CenteredMessage>
          <Notice tone={notFound ? "info" : "danger"}>
            {notFound ? "This student no longer exists." : "We couldn't load this student. Try again shortly."}
          </Notice>
          {notFound ? null : (
            <Button title="Try again" variant="secondary" onPress={() => void student.refetch()} />
          )}
        </CenteredMessage>
      </Screen>
    );
  }

  const s = student.data;
  const name = [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
  const active = s.status === "ACTIVE";
  const busy = update.isPending || leave.isPending || place.isPending;
  const unplaced = abilities.place && needsPlacement(s, currentTerm?.termId ?? null);
  const activeArms = (arms.data ?? []).filter((arm) => arm.isActive);

  function confirmPlace(): void {
    const arm = activeArms.find((a) => a.id === placeArmId);
    if (!arm || !currentTerm) return;
    Alert.alert(
      `Place ${s.firstName} in ${arm.name}?`,
      `For ${currentTerm.termName}. They will appear on ${arm.name}'s register and in its gradebook.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Place", onPress: () => place.mutate(arm.id) },
      ],
    );
  }
  const fullEditor = webUrl(`/students/${s.id}`);

  function startEdit(): void {
    setPhone(s.phone ?? "");
    setAddress(s.address ?? "");
    setEditing(true);
  }

  function confirmLeave(kind: "withdraw" | "graduate"): void {
    Alert.alert(
      kind === "withdraw" ? `Withdraw ${s.firstName}?` : `Mark ${s.firstName} as graduated?`,
      kind === "withdraw"
        ? "They will be removed from the active roll and from class registers. Their records are kept."
        : "They will leave the active roll as a graduate. Their records and results are kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: kind === "withdraw" ? "Withdraw" : "Graduate",
          style: "destructive",
          onPress: () => leave.mutate(kind),
        },
      ],
    );
  }

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title={name}
            subtitle={`${s.admissionNumber}${active ? "" : ` · ${s.status.toLowerCase()}`}`}
          />

          {notice ? <Notice tone="info">{notice}</Notice> : null}
          {failure ? <Notice tone="danger">{failure}</Notice> : null}

          <Card style={styles.card}>
            <StatRow
              icon="school-outline"
              value={s.currentEnrollment?.classArm.name ?? "Not placed in a class"}
              label={s.currentEnrollment ? s.currentEnrollment.classArm.classLevel.name : "This term"}
            />
            <StatRow icon="calendar-outline" value={formatDate(s.dateOfBirth)} label="Date of birth" />
            <StatRow
              icon="person-outline"
              value={s.gender.charAt(0) + s.gender.slice(1).toLowerCase()}
              label="Gender"
            />
            <StatRow icon="enter-outline" value={formatDate(s.admittedAt)} label="Admitted" />
          </Card>

          {unplaced ? (
            <Card style={styles.card}>
              <Body>
                {s.firstName} has no class for {currentTerm?.termName ?? "this term"}. Choose one — nothing is
                picked for you.
              </Body>
              {arms.isPending ? <Skeleton lines={2} /> : null}
              <ChoiceChips
                options={activeArms.map((arm) => ({ value: arm.id, label: arm.name }))}
                value={placeArmId}
                onChange={setPlaceArmId}
              />
              <Button
                title="Place in this class"
                loading={place.isPending}
                disabled={busy || placeArmId === null}
                onPress={confirmPlace}
              />
            </Card>
          ) : null}

          <SectionHeader title="Contact" />
          {editing ? (
            <Card style={styles.card}>
              <Label>Phone</Label>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                accessibilityLabel="Phone"
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
              />
              <Label>Home address</Label>
              <TextInput
                value={address}
                onChangeText={setAddress}
                multiline
                accessibilityLabel="Home address"
                style={[styles.textarea, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
              />
              <Button
                title="Save"
                loading={update.isPending}
                disabled={busy}
                onPress={() =>
                  update.mutate({
                    // Cleared means cleared: the schema is nullable for that.
                    phone: phone.trim() === "" ? null : phone.trim(),
                    address: address.trim() === "" ? null : address.trim(),
                  })
                }
              />
              <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} />
            </Card>
          ) : (
            <Card style={styles.card}>
              <StatRow icon="call-outline" value={s.phone ?? "No phone recorded"} label="Phone" />
              <StatRow icon="home-outline" value={s.address ?? "No address recorded"} label="Home address" />
              {active ? <Button title="Edit contact" variant="secondary" onPress={startEdit} /> : null}
            </Card>
          )}

          {s.guardians.length > 0 || abilities.link ? (
            <SectionHeader title="Parents and guardians" />
          ) : null}
          {s.guardians.map((guardian) => (
            <ListRow
              key={guardian.linkId}
              icon="people-outline"
              title={`${guardian.firstName} ${guardian.lastName}${guardian.isPrimary ? " · main contact" : ""}`}
              subtitle={`${guardian.relationship.toLowerCase()} · ${guardian.phone} · ${describePortalStatus(guardian.portalStatus)}`}
              onPress={
                abilities.invite || abilities.update
                  ? () =>
                      router.push({
                        pathname: "/staff/students/parent",
                        params: { id: guardian.id, studentId: s.id },
                      })
                  : undefined
              }
            />
          ))}
          {abilities.link && active ? (
            <Button
              title={s.guardians.length === 0 ? "Link a parent" : "Link another parent"}
              variant="secondary"
              onPress={() =>
                router.push({ pathname: "/staff/students/link-parent", params: { studentId: s.id } })
              }
            />
          ) : null}

          {fullEditor ? (
            <Button
              title="Full record on the website"
              variant="secondary"
              onPress={() => void Linking.openURL(fullEditor)}
            />
          ) : null}

          {active ? (
            <View style={styles.danger}>
              <SectionHeader title="Leaving the school" />
              <Button title="Withdraw" variant="secondary" disabled={busy} onPress={() => confirmLeave("withdraw")} />
              <Button title="Graduate" variant="secondary" disabled={busy} onPress={() => confirmLeave("graduate")} />
            </View>
          ) : (
            <Body muted>
              {s.status === "GRADUATED"
                ? `Graduated ${formatDate(s.graduatedAt)}.`
                : s.status === "WITHDRAWN"
                  ? `Withdrawn ${formatDate(s.withdrawnAt)}.`
                  : `Status: ${s.status.toLowerCase()}.`}
            </Body>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  card: { gap: spacing.xs },
  danger: { gap: spacing.sm, paddingTop: spacing.md },
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
});
