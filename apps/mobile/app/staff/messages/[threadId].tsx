import { useState } from "react";
import { Linking, RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MESSAGE_LIMITS, type MessageRecipient, type StaffMessageThreadDto } from "@school-kit/types";

import { ChoiceChips, TextField } from "../../../src/components/form";
import { ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { MessagePhotoPicker, type PickedPhoto } from "../../../src/components/message-photo-picker";
import { MessageThread } from "../../../src/components/message-thread";
import { Body, Button, Caption, Card, Notice, Screen } from "../../../src/components/ui";
import { ApiError } from "../../../src/lib/api/client";
import { staffStageMessageImage } from "../../../src/lib/api/message-images";
import {
  staffClearMessageFlag,
  staffCloseMessage,
  staffFlagMessage,
  staffMarkHandled,
  staffMessageThread,
  staffPassMessage,
  staffReplyMessage,
} from "../../../src/lib/api/staff-messages";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP8.1 — one conversation (docs/modules/phase-9.md §17.8): reply,
// pass it to another recipient, mark that you are handling it, or close it.
// CP8.2: photos; flag it for the owner and admins; and, for them, why it was
// flagged and "Clear flag".
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
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [flagging, setFlagging] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
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

  async function clearFlag() {
    setBusy(true);
    setError(null);
    try {
      await staffClearMessageFlag(threadId);
      void queryClient.invalidateQueries({ queryKey: ["staff", staff?.school.id ?? "", staff?.user.id ?? "", "messages"] });
      setNotice("Flag cleared. The conversation is back with the people it was addressed to.");
      try {
        queryClient.setQueryData(key, await staffMessageThread(threadId));
      } catch {
        // No longer ours to see; the notice says why.
      }
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
            {t.flag ? (
              <Notice tone="warning">
                {`Flagged: ${t.flag.label}.${t.flag.note ? ` “${t.flag.note}”` : ""} The owner and admins can see this conversation until the flag is cleared.`}
              </Notice>
            ) : null}
            {t.canClearFlag ? <Button title="Clear flag" variant="secondary" disabled={busy} onPress={() => void clearFlag()} /> : null}
            <MessageThread messages={t.messages} safeguardingIds={t.safeguardingMessageIds} />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            {notice ? <Notice tone="info">{notice}</Notice> : null}
            {t.status === "OPEN" ? (
              <>
                <TextField label="Reply" value={reply} onChangeText={setReply} multiline maxLength={MESSAGE_LIMITS.body} />
                <MessagePhotoPicker photos={photos} onChange={setPhotos} stage={staffStageMessageImage} />
                <Button
                  title="Send reply"
                  loading={busy}
                  disabled={!reply.trim() && photos.length === 0}
                  onPress={() =>
                    void run(
                      () => staffReplyMessage(threadId, reply.trim(), photos.map((p) => p.id)),
                      () => {
                        setReply("");
                        setPhotos([]);
                      },
                    )
                  }
                />
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
                {!t.flag && !flagging ? <Button title="Flag for the owner and admins" variant="secondary" disabled={busy} onPress={() => setFlagging(true)} /> : null}
                {flagging ? (
                  <>
                    <TextField label="Why are you flagging it? (optional)" value={flagNote} onChangeText={setFlagNote} multiline maxLength={MESSAGE_LIMITS.flagNote} />
                    <Caption>The owner and admins will be able to read the whole conversation. The parent is not told.</Caption>
                    <Button
                      title="Flag it"
                      loading={busy}
                      onPress={() =>
                        void run(
                          () => staffFlagMessage(threadId, flagNote.trim()),
                          () => {
                            setFlagging(false);
                            setFlagNote("");
                            setNotice("Flagged. The owner and admins have been told and can now read this conversation.");
                          },
                        )
                      }
                    />
                    <Button title="Cancel" variant="secondary" onPress={() => setFlagging(false)} />
                  </>
                ) : null}
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
