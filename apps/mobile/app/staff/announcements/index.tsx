import { useCallback, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  type AnnouncementAudience,
  type AnnouncementDto,
} from "@school-kit/types";

import {
  createStaffAnnouncement,
  markStaffAnnouncementRead,
  staffAnnouncementFeed,
  staffAnnouncementsSent,
  withdrawStaffAnnouncement,
} from "../../../src/lib/api/staff-announcements";
import { staffClassArms } from "../../../src/lib/api/staff-students";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { isSchoolAdmin } from "../../../src/lib/auth/roles";
import { AnnouncementFeed } from "../../../src/components/announcement-feed";
import { useTheme } from "../../../src/theme/theme-provider";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, Heading, Label, Notice, Screen } from "../../../src/components/ui";
import { EmptyState, ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";
import { ChoiceChips, TextField } from "../../../src/components/form";

// Announcements on the phone (docs/modules/announcements.md).
//
// One screen, two jobs, because the person doing them is often the same
// person: everyone who opens it READS what the school has sent them, and an
// owner or admin also SENDS. Splitting them would mean a head checking
// whether a message went out has to leave the screen they sent it from.
//
// Sending is owner/admin only and the server enforces that twice (the
// permission grant, and a role re-check in the service). The gate here is the
// same isSchoolAdmin() every other admin-only phone screen uses — cosmetic,
// not the boundary.
//
// The confirmation before sending names WHO it is about to reach, and says
// plainly that an announcement cannot be unsent: withdrawing takes it out of
// the feeds, but the phones have already buzzed.

const AUDIENCE_OPTIONS: readonly { value: AnnouncementAudience; label: string }[] = [
  { value: "EVERYONE", label: "Everyone" },
  { value: "PARENTS", label: "Parents" },
  { value: "STAFF", label: "Staff" },
  { value: "CLASS", label: "One class" },
];

const AUDIENCE_WORDS: Record<AnnouncementAudience, string> = {
  EVERYONE: "everyone — parents, students and staff",
  PARENTS: "every parent",
  STAFF: "your staff",
  CLASS: "one class",
};

function when(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StaffAnnouncementsScreen() {
  const { status, principal, staff } = useSession();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "";
  const admin = isSchoolAdmin(staff?.roles);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AnnouncementAudience>("EVERYONE");
  const [classArmId, setClassArmId] = useState<string | null>(null);
  const [urgent, setUrgent] = useState(false);

  const feed = useQuery({
    queryKey: queryKeys.staffAnnouncementFeed(schoolId, userId),
    queryFn: () => staffAnnouncementFeed(),
    enabled: ready,
    staleTime: 5 * 60_000,
  });

  const sent = useQuery({
    queryKey: queryKeys.staffAnnouncements(schoolId, userId),
    queryFn: () => staffAnnouncementsSent(),
    enabled: ready && admin,
    staleTime: 5 * 60_000,
  });

  const arms = useQuery({
    queryKey: queryKeys.staffClassArms(schoolId, userId),
    queryFn: () => staffClassArms(),
    // Only fetched once a class announcement is actually being written: the
    // roster of classes is not this screen's subject.
    enabled: ready && admin && audience === "CLASS",
    staleTime: 60 * 60_000,
  });

  const markRead = useMutation({ mutationFn: (id: string) => markStaffAnnouncementRead(id) });
  const onRead = useCallback((id: string) => markRead.mutate(id), [markRead]);

  const send = useMutation({
    mutationFn: () =>
      createStaffAnnouncement({
        title: title.trim(),
        body: body.trim(),
        audience,
        ...(audience === "CLASS" && classArmId ? { classArmId } : {}),
        ...(urgent ? { urgent: true } : {}),
      }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      setUrgent(false);
      setClassArmId(null);
      setAudience("EVERYONE");
      void queryClient.invalidateQueries({ queryKey: queryKeys.staffAnnouncements(schoolId, userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.staffAnnouncementFeed(schoolId, userId) });
      Alert.alert("Sent", "Everyone it was addressed to will see it.");
    },
    onError: () => Alert.alert("Not sent", "We couldn't send that. Check your connection and try again."),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawStaffAnnouncement(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.staffAnnouncements(schoolId, userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.staffAnnouncementFeed(schoolId, userId) });
    },
    onError: () => Alert.alert("Not withdrawn", "We couldn't withdraw that. Try again in a moment."),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const canSend =
    title.trim() !== "" && body.trim() !== "" && (audience !== "CLASS" || classArmId !== null) && !send.isPending;

  function confirmSend(): void {
    const armName = arms.data?.find((a) => a.id === classArmId)?.name;
    const who = audience === "CLASS" ? (armName ?? "one class") : AUDIENCE_WORDS[audience];
    const warning = urgent ? "\n\nMarked urgent: it will wake phones tonight, outside quiet hours." : "";
    Alert.alert(
      "Send this?",
      `"${title.trim()}" goes to ${who}.${warning}\n\nAn announcement cannot be unsent.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send", onPress: () => send.mutate() },
      ],
    );
  }

  function confirmWithdraw(item: AnnouncementDto): void {
    Alert.alert(
      "Withdraw this?",
      `"${item.title}" disappears from the feeds. Anyone who has already read it has read it.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Withdraw", style: "destructive", onPress: () => withdraw.mutate(item.id) },
      ],
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Announcements" }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={feed.isRefetching || sent.isRefetching}
              onRefresh={() => {
                void feed.refetch();
                if (admin) void sent.refetch();
              }}
              tintColor={colors.primary}
            />
          }
        >
          <ScreenHeader
            title="Announcements"
            subtitle={admin ? "Send one message to the whole school." : "What the school has sent you."}
          />

          {admin && (
            <Card>
              <Heading>New announcement</Heading>
              <View style={styles.form}>
                <TextField
                  label="Title"
                  value={title}
                  onChangeText={setTitle}
                  maxLength={ANNOUNCEMENT_TITLE_MAX}
                  placeholder="Gate closed tomorrow"
                  autoCapitalize="sentences"
                />
                <TextField
                  label="Message"
                  value={body}
                  onChangeText={setBody}
                  multiline
                  maxLength={ANNOUNCEMENT_BODY_MAX}
                  placeholder="Write it as you would say it at the gate."
                  autoCapitalize="sentences"
                />
                <ChoiceChips
                  label="Who sees it"
                  options={AUDIENCE_OPTIONS}
                  value={audience}
                  onChange={(next) => {
                    setAudience(next);
                    if (next !== "CLASS") setClassArmId(null);
                  }}
                />
                {audience === "CLASS" &&
                  (arms.isPending ? (
                    <Skeleton lines={2} />
                  ) : (
                    <ChoiceChips
                      label="Class"
                      options={(arms.data ?? []).map((arm) => ({ value: arm.id, label: arm.name }))}
                      value={classArmId}
                      onChange={setClassArmId}
                    />
                  ))}
                <ChoiceChips
                  label="Urgent"
                  options={[
                    { value: "no", label: "Normal" },
                    { value: "yes", label: "Urgent — wakes phones" },
                  ]}
                  value={urgent ? "yes" : "no"}
                  onChange={(next) => setUrgent(next === "yes")}
                />
                {urgent && (
                  <Notice tone="warning">
                    Urgent skips quiet hours (9pm–6am) and buzzes phones at any time. It is recorded against your name.
                  </Notice>
                )}
                <Button
                  title={send.isPending ? "Sending…" : "Send announcement"}
                  onPress={confirmSend}
                  disabled={!canSend}
                />
              </View>
            </Card>
          )}

          <SectionHeader title="For you" />
          {feed.isPending ? (
            <Skeleton lines={4} />
          ) : feed.isError && !feed.data ? (
            <Notice tone="danger">We couldn&apos;t load your messages.</Notice>
          ) : (feed.data?.data.length ?? 0) === 0 ? (
            <EmptyState icon="megaphone-outline" title="Nothing for you" body="Messages addressed to you appear here." />
          ) : (
            <AnnouncementFeed items={feed.data!.data} onRead={onRead} />
          )}

          {admin && (
            <>
              <SectionHeader title="Sent" note="Everything the school has announced." />
              {sent.isPending ? (
                <Skeleton lines={4} />
              ) : sent.isError && !sent.data ? (
                <Notice tone="danger">We couldn&apos;t load what has been sent.</Notice>
              ) : (sent.data?.data.length ?? 0) === 0 ? (
                <EmptyState icon="megaphone-outline" title="Nothing sent yet" body="What you send appears here." />
              ) : (
                sent.data!.data.map((item) => (
                  <Card key={item.id}>
                    <Heading>{item.title}</Heading>
                    <Label>
                      {item.audience === "CLASS" ? (item.className ?? "One class") : AUDIENCE_WORDS[item.audience]} ·{" "}
                      {when(item.createdAt)}
                      {item.urgent ? " · urgent" : ""}
                      {item.withdrawnAt ? " · withdrawn" : ""}
                    </Label>
                    <Body>{item.body}</Body>
                    {!item.withdrawnAt && (
                      <Button title="Withdraw" variant="secondary" onPress={() => confirmWithdraw(item)} />
                    )}
                  </Card>
                ))
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md },
  form: { gap: spacing.sm, marginTop: spacing.sm },
});
