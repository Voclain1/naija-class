import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Share, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  staffGetGuardian,
  staffInviteGuardian,
  staffResendGuardianInvite,
  staffRevokeGuardianInvite,
  staffUpdateGuardian,
} from "../../../src/lib/api/staff-guardians";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import {
  RELATIONSHIP_LABELS,
  describePortalStatus,
  isPlausibleEmail,
  parentAbilities,
  portalActions,
} from "../../../src/lib/staff/guardian-form";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, CenteredMessage, Label, Notice, Screen } from "../../../src/components/ui";
import { ListRow, ScreenHeader, SectionHeader, Skeleton, StatRow } from "../../../src/components/layout";
import { TextField } from "../../../src/components/form";

// CP9a — one parent, and their access to the parent app.
//
// The buttons are exactly the portal actions the server accepts for this
// parent's status (guardian-form.ts → portalActions).
//
// The invitation link is a CREDENTIAL: whoever opens it sets the password.
// It is returned once, by the invite or resend call, and lives only in this
// screen's memory — never cached, never persisted, gone when the screen
// closes. The admin can share it straight to the parent (WhatsApp is how most
// Nigerian parents will actually receive it), and the screen says plainly who
// it must go to.

function describeFailure(error: unknown): string {
  if (error instanceof ApiNetworkError) {
    return "Your phone couldn't reach the server. Nothing changed — try again when you have signal.";
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case "GUARDIAN_HAS_NO_EMAIL":
        return "Add an email address for this parent first.";
      case "GUARDIAN_ALREADY_ACTIVE":
        return "This parent already uses the parent app.";
      case "INVITATION_ALREADY_PENDING":
        return "They already have a live invitation. Use Resend to send a fresh one.";
      case "NO_PENDING_INVITATION":
        return "There is no live invitation to cancel — it may have been used or expired.";
      case "GUARDIAN_EMAIL_ALREADY_EXISTS":
        return "Another parent at this school already uses that email.";
    }
    return error.message || "That couldn't be done.";
  }
  return "That couldn't be done.";
}

export default function ParentScreen() {
  const queryClient = useQueryClient();
  const { id, studentId } = useLocalSearchParams<{ id: string; studentId?: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const abilities = parentAbilities(staff?.roles, staff?.permissions ?? []);
  const key = queryKeys.staffGuardian(schoolId, userId, id ?? "");

  const guardian = useQuery({
    queryKey: key,
    queryFn: () => staffGetGuardian(id as string),
    enabled: authed && (abilities.invite || abilities.update) && !!id && schoolId !== "",
    staleTime: 15_000,
  });

  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [addingEmail, setAddingEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      studentId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.staffStudent(schoolId, userId, studentId) })
        : Promise.resolve(),
    ]);
  }

  const portal = useMutation({
    mutationFn: async (action: "invite" | "resend" | "revoke") => {
      if (action === "invite") return { action, url: (await staffInviteGuardian(id as string)).acceptUrl };
      if (action === "resend") return { action, url: (await staffResendGuardianInvite(id as string)).acceptUrl };
      await staffRevokeGuardianInvite(id as string);
      return { action, url: null };
    },
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: async ({ action, url }) => {
      setAcceptUrl(url);
      setNotice(
        action === "revoke"
          ? "The invitation was cancelled. The link they were sent no longer works."
          : action === "resend"
            ? "A fresh invitation was sent. The previous link no longer works."
            : "The invitation was sent to their email, and by text if your school sends invitation texts.",
      );
      await refresh();
    },
    onError: (error) => setFailure(describeFailure(error)),
  });

  const saveEmail = useMutation({
    mutationFn: (value: string) => staffUpdateGuardian(id as string, { email: value }),
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: async () => {
      setAddingEmail(false);
      setNotice("Email saved. You can invite them now.");
      await refresh();
    },
    onError: (error) => setFailure(describeFailure(error)),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (!abilities.invite && !abilities.update) {
    return (
      <Screen>
        {header}
        <Notice tone="info">Parents are managed by owners and administrators.</Notice>
      </Screen>
    );
  }

  if (guardian.isPending) {
    return (
      <Screen>
        {header}
        <Skeleton lines={5} />
      </Screen>
    );
  }

  if (guardian.isError || !guardian.data) {
    return (
      <Screen>
        {header}
        <CenteredMessage>
          <Notice tone="danger">We couldn&apos;t load this parent. Try again shortly.</Notice>
          <Button title="Try again" variant="secondary" onPress={() => void guardian.refetch()} />
        </CenteredMessage>
      </Screen>
    );
  }

  const g = guardian.data;
  const actions = portalActions(g.portalStatus);
  const busy = portal.isPending || saveEmail.isPending;
  const fullName = `${g.firstName} ${g.lastName}`;

  function confirm(action: "invite" | "resend" | "revoke"): void {
    const copy = {
      invite: {
        title: `Invite ${g.firstName} to the parent app?`,
        body: `An invitation goes to ${g.email}. They set their own password and then see their children's results, fees and attendance.`,
        ok: "Send invitation",
      },
      resend: {
        title: "Send a fresh invitation?",
        body: "The link they already have stops working, and a new one is sent.",
        ok: "Resend",
      },
      revoke: {
        title: "Cancel the invitation?",
        body: "The link they were sent stops working. You can invite them again later.",
        ok: "Cancel invitation",
      },
    }[action];
    Alert.alert(copy.title, copy.body, [
      { text: "Back", style: "cancel" },
      { text: copy.ok, style: action === "revoke" ? "destructive" : "default", onPress: () => portal.mutate(action) },
    ]);
  }

  function shareLink(): void {
    if (!acceptUrl) return;
    void Share.share({
      message: `Hello ${g.firstName}, ${staff?.school.name ?? "the school"} has invited you to the parent app. Open this link to set your password (it expires in 7 days): ${acceptUrl}`,
    });
  }

  function submitEmail(): void {
    const value = email.trim().toLowerCase();
    if (!isPlausibleEmail(value)) {
      setEmailError("That doesn't look like an email address.");
      return;
    }
    setEmailError(null);
    saveEmail.mutate(value);
  }

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader title={fullName} subtitle={RELATIONSHIP_LABELS[g.relationship]} />

          {notice ? <Notice tone="info">{notice}</Notice> : null}
          {failure ? <Notice tone="danger">{failure}</Notice> : null}

          <Card style={styles.card}>
            <StatRow icon="call-outline" value={g.phone} label="Phone" />
            <StatRow icon="mail-outline" value={g.email ?? "No email recorded"} label="Email" />
            <StatRow
              icon="phone-portrait-outline"
              tone={g.portalStatus === "EXPIRED" ? "warning" : undefined}
              value={describePortalStatus(g.portalStatus)}
              label="Parent app"
            />
          </Card>

          {acceptUrl ? (
            <Card style={styles.card}>
              <Label>Their invitation link</Label>
              <Body muted>
                Anyone who opens this link can set the password for {g.firstName}&apos;s account. Send it only
                to {g.firstName}, for example on WhatsApp. It is not shown again once you leave this page.
              </Body>
              <Button title="Share the link" onPress={shareLink} />
            </Card>
          ) : null}

          {abilities.invite && actions.includes("invite") ? (
            <Button title="Invite to the parent app" loading={portal.isPending} disabled={busy} onPress={() => confirm("invite")} />
          ) : null}
          {abilities.invite && actions.includes("resend") ? (
            <Button title="Resend invitation" loading={portal.isPending} disabled={busy} onPress={() => confirm("resend")} />
          ) : null}
          {abilities.invite && actions.includes("revoke") ? (
            <Button title="Cancel invitation" variant="secondary" disabled={busy} onPress={() => confirm("revoke")} />
          ) : null}

          {abilities.update && actions.includes("add-email") ? (
            addingEmail ? (
              <Card style={styles.card}>
                <TextField
                  label="Email address"
                  value={email}
                  onChangeText={setEmail}
                  error={emailError}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Button title="Save email" loading={saveEmail.isPending} disabled={busy} onPress={submitEmail} />
                <Button title="Cancel" variant="secondary" onPress={() => setAddingEmail(false)} />
              </Card>
            ) : (
              <Button title="Add an email address" variant="secondary" onPress={() => setAddingEmail(true)} />
            )
          ) : null}

          {g.students.length > 0 ? (
            <>
              <SectionHeader title="Children" />
              {g.students.map((child) => (
                <ListRow
                  key={child.linkId}
                  icon="person-outline"
                  title={`${child.firstName} ${child.lastName}`}
                  subtitle={[child.admissionNumber, child.isPrimary ? "main contact" : null].filter(Boolean).join(" · ")}
                />
              ))}
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
  card: { gap: spacing.sm },
});
