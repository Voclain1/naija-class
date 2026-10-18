import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MESSAGE_LIMITS, type MessageGuardianOptionDto } from "@school-kit/types";

import { ChoiceChips, TextField } from "../../../src/components/form";
import { ListRow, ScreenHeader, Skeleton } from "../../../src/components/layout";
import { Body, Button, Card, Label, Notice, Screen } from "../../../src/components/ui";
import { ApiError } from "../../../src/lib/api/client";
import { staffSearchMessageGuardians, staffStartMessage } from "../../../src/lib/api/staff-messages";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { lastDigits } from "../../../src/lib/staff/messages";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP11.1 — the school office writes to a parent first, as on the
// website (messages.start; docs/modules/phase-9.md §20). Find the parent by
// name, choose one of their children or "General", write, send. The new
// conversation opens straight after.

const GENERAL = "general";

export default function StartMessageScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canStart = hasPermission(staff?.permissions ?? [], "messages.start");
  const [q, setQ] = useState("");
  const [parent, setParent] = useState<MessageGuardianOptionDto | null>(null);
  const [about, setAbout] = useState<string>(GENERAL);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const term = q.trim();

  const found = useQuery({
    queryKey: queryKeys.staffMessageGuardians(staff?.school.id ?? "", staff?.user.id ?? "", term.toLowerCase()),
    queryFn: () => staffSearchMessageGuardians(term),
    enabled: authed && canStart && parent === null && term.length >= 2,
    staleTime: 30_000,
  });

  const send = useMutation({
    mutationFn: () =>
      staffStartMessage({ guardianId: parent!.id, studentId: about === GENERAL ? null : about, subject: subject.trim(), body: body.trim() }),
    onSuccess: (thread) => router.replace({ pathname: "/staff/messages/[threadId]", params: { threadId: thread.id } }),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const ready = parent !== null && subject.trim() !== "" && body.trim() !== "";
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Write to a parent" />
        {!canStart ? (
          <Notice tone="info">Writing to a parent first is for the school office. Your account can reply when a parent writes to you.</Notice>
        ) : parent === null ? (
          <>
            <TextField label="Find the parent" value={q} onChangeText={setQ} placeholder="Parent's or child's name" autoCapitalize="words" />
            {term.length < 2 ? (
              <Body muted>Type at least two letters.</Body>
            ) : found.isLoading ? (
              <Skeleton lines={3} />
            ) : found.isError ? (
              <Notice tone="danger">{found.error instanceof ApiError ? found.error.message : "The search did not work. Try again."}</Notice>
            ) : (found.data ?? []).length === 0 ? (
              <Body muted>{`No parent matches "${term}".`}</Body>
            ) : (
              (found.data ?? []).map((g) => (
                <ListRow
                  key={g.id}
                  icon="person-outline"
                  title={g.name}
                  subtitle={`${g.children.map((c) => c.name).join(", ") || "No children listed"} · phone ending ${lastDigits(g.phone)}`}
                  onPress={() => {
                    setParent(g);
                    setAbout(g.children.length === 1 ? g.children[0]!.id : GENERAL);
                  }}
                />
              ))
            )}
          </>
        ) : (
          <>
            <Card style={styles.card}>
              <Label>To</Label>
              <Body>{parent.name}</Body>
              <Button title="Choose someone else" variant="secondary" onPress={() => setParent(null)} />
            </Card>
            <ChoiceChips
              label="About"
              options={[...parent.children.map((c) => ({ value: c.id, label: c.name })), { value: GENERAL, label: "General" }]}
              value={about}
              onChange={setAbout}
            />
            <TextField label="Subject" value={subject} onChangeText={setSubject} maxLength={MESSAGE_LIMITS.subject} />
            <TextField label="Message" value={body} onChangeText={setBody} multiline maxLength={MESSAGE_LIMITS.body} />
            {send.isError ? (
              <Notice tone="danger">{send.error instanceof ApiError ? send.error.message : "The message was not sent. Try again."}</Notice>
            ) : null}
            <Button title="Send" loading={send.isPending} disabled={!ready || send.isPending} onPress={() => send.mutate()} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingVertical: spacing.md, paddingBottom: spacing.xl },
  card: { gap: spacing.xs },
});
