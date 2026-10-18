import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MESSAGE_LIMITS } from "@school-kit/types";

import { TextField } from "../../src/components/form";
import { ScreenHeader, Skeleton } from "../../src/components/layout";
import { LoadError } from "../../src/components/load-error";
import { MessagePhotoPicker, type PickedPhoto } from "../../src/components/message-photo-picker";
import { MessageThread } from "../../src/components/message-thread";
import { Button, Caption, Notice, Screen } from "../../src/components/ui";
import { ApiError } from "../../src/lib/api/client";
import { guardianStageMessageImage } from "../../src/lib/api/message-images";
import { guardianMessage, guardianReplyMessage, guardianReportMessage } from "../../src/lib/api/portal";
import { useSession } from "../../src/lib/auth/session";
import { queryKeys } from "../../src/lib/query/keys";
import { spacing } from "../../src/theme/tokens";

// Phase 9 / CP8.1 — one conversation (docs/modules/phase-9.md §17.8). Replies
// are signed by who answered, or by the school office; "Seen" shows once the
// school has opened the parent's latest message.
//
// CP8.2: photos, and "Report this conversation" to the school's owner and
// admins. The parent sees that they reported it, nothing more.
export default function MessageScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, principal } = useSession();
  const authed = status === "authenticated" && principal === "guardian";
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [reporting, setReporting] = useState(false);
  const [reportNote, setReportNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const thread = useQuery({ queryKey: queryKeys.guardianMessage(id), queryFn: () => guardianMessage(id), enabled: authed });

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "guardian") return <Redirect href="/" />;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const next = await guardianReplyMessage(id, reply.trim(), photos.map((p) => p.id));
      queryClient.setQueryData(queryKeys.guardianMessage(id), next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.guardianMessages });
      setReply("");
      setPhotos([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Your reply was not sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function report() {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(queryKeys.guardianMessage(id), await guardianReportMessage(id, reportNote.trim()));
      setReporting(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The report was not sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const t = thread.data;
  const lastMine = t ? [...t.messages].reverse().find((m) => m.mine) : undefined;
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
            <ScreenHeader title={t.subject} subtitle={`With ${t.withLabel}${t.childName ? ` · about ${t.childName}` : ""}`} />
            <MessageThread messages={t.messages} seenAfterId={t.seen ? (lastMine?.id ?? null) : null} />
            {t.status === "CLOSED" ? (
              <>
                <Notice tone="info">This conversation is closed.</Notice>
                <Button title="Write a new message" variant="secondary" onPress={() => router.push("/messages/new")} />
              </>
            ) : (
              <>
                <TextField label="Reply" value={reply} onChangeText={setReply} multiline maxLength={MESSAGE_LIMITS.body} />
                <MessagePhotoPicker photos={photos} onChange={setPhotos} stage={guardianStageMessageImage} />
                <Button title="Send" onPress={() => void send()} loading={busy} disabled={!reply.trim() && photos.length === 0} />
              </>
            )}
            {error ? <Notice tone="danger">{error}</Notice> : null}
            {t.reported ? (
              <Notice tone="warning">You reported this conversation. The school&apos;s owner and admins can read it.</Notice>
            ) : reporting ? (
              <>
                <Caption>If something in this conversation worries you, report it. The school&apos;s owner and admins will be told and can read the whole conversation.</Caption>
                <TextField label="What worries you? (optional)" value={reportNote} onChangeText={setReportNote} multiline maxLength={MESSAGE_LIMITS.flagNote} />
                <Button title="Report" onPress={() => void report()} loading={busy} />
                <Button title="Cancel" variant="secondary" onPress={() => setReporting(false)} />
              </>
            ) : (
              <Button title="Report this conversation" variant="secondary" onPress={() => setReporting(true)} />
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
