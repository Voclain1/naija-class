import { useState } from "react";
import { Linking, RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MESSAGE_LIMITS, type MessageRecipient, type StaffMessageThreadDto } from "@school-kit/types";

import { ChoiceChips, TextField } from "../../../src/components/form";
import { ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { MessageThread } from "../../../src/components/message-thread";
import { Body, Button, Caption, Card, Notice, Screen } from "../../../src/components/ui";
import { ApiError } from "../../../src/lib/api/client";
import { staffCloseMessage, staffMarkHandled, staffMessageThread, staffPassMessage, staffReplyMessage } from "../../../src/lib/api/staff-messages";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP8.1 — one conversation (docs/modules/phase-9.md §17.8): reply,
// pass it to another recipient, mark that you are handling it, or close it.
export default function StaffMessageScreen() {
  const queryClient = useQueryClient();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const key = queryKeys.staffMessage(staff?.school.id ?? "", staff?.user.id ?? "", threadId);
  const thread = useQuery({ queryKey: key, queryFn: () => staffMessageThread(threadId), enabled: authed });
  const [reply, setReply] = useState("");
  const [passTo, setPassTo] = useState<MessageRecipient | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  async function run(action: () => Promise<StaffMessageThreadDto>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(key, await action());
      void queryClient.invalidateQueries({ queryKey: ["staff", staff?.school.id ?? "", staff?.user.id ?? "", "messages"] });
      after?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const t = thread.data;
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={thread.isRefetching} onRefresh={() => void thread.refetch()} />}
      >
        {thread.isLoading ? (
          <Skeleton lines={4} />
        ) : thread.isError || !t ? (
          <LoadError error={thread.error} what="the conversation" onRetry={() => void thread.refetch()} />
        ) : (
          <>
            <ScreenHeader title={t.subject} subtitle={`To ${t.addressedTo.join(", then ")}`} />
            <Card>
              <Body>
                {t.guardian.name}
                {t.child ? ` · about ${t.child.name}${t.child.className ? `, ${t.child.className}` : ""}` : " · general"}
              </Body>
              <Button title={`Call ${t.guardian.phone}`} variant="secondary" onPress={() => void Linking.openURL(`tel:${t.guardian.phone}`)} />
            </Card>
            <MessageThread messages={t.messages} />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            {t.status === "OPEN" ? (
              <>
                <TextField label="Reply" value={reply} onChangeText={setReply} multiline maxLength={MESSAGE_LIMITS.body} />
                <Button title="Send reply" loading={busy} disabled={!reply.trim()} onPress={() => void run(() => staffReplyMessage(threadId, reply.trim()), () => setReply(""))} />
                {t.passOptions.length > 0 ? (
                  <>
                    <ChoiceChips label="Pass to" options={t.passOptions.map((o) => ({ value: o.recipient, label: o.name ? `${o.label} (${o.name})` : o.label }))} value={passTo} onChange={setPassTo} />
                    <Button title="Pass on" variant="secondary" disabled={!passTo || busy} onPress={() => passTo && void run(() => staffPassMessage(threadId, passTo), () => setPassTo(null))} />
                  </>
                ) : null}
                <Button
                  title={t.handledBy ? `Handled by ${t.handledBy}: clear` : "I'm handling this"}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void run(() => staffMarkHandled(threadId, !t.handledBy))}
                />
                <Button title="Close conversation" variant="secondary" disabled={busy} onPress={() => void run(() => staffCloseMessage(threadId))} />
                <Caption>Only those it is addressed or passed to can see this conversation.</Caption>
              </>
            ) : (
              <Notice tone="info">Closed. The parent can start a new conversation.</Notice>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
});
