import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MESSAGE_LIMITS, type MessageRecipient } from "@school-kit/types";

import { ChoiceChips, TextField } from "../../src/components/form";
import { Skeleton } from "../../src/components/layout";
import { MessagePhotoPicker, type PickedPhoto } from "../../src/components/message-photo-picker";
import { Body, Button, Caption, Notice, Screen } from "../../src/components/ui";
import { ApiError } from "../../src/lib/api/client";
import { guardianStageMessageImage } from "../../src/lib/api/message-images";
import { guardianMessageRecipients, guardianStartMessage, listStudents } from "../../src/lib/api/portal";
import { useSession } from "../../src/lib/auth/session";
import { queryKeys } from "../../src/lib/query/keys";
import { spacing } from "../../src/theme/tokens";

// Phase 9 / CP8.1 — writing to the school (docs/modules/phase-9.md §17.8).
// About one child, or general; to the child's form or class teacher, the
// bursar, the principal or head teacher, the school admin, or the office.

const GENERAL = "general";

export default function NewMessageScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, principal } = useSession();
  const authed = status === "authenticated" && principal === "guardian";
  const [about, setAbout] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<MessageRecipient | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const children = useQuery({ queryKey: ["messages", "children"], queryFn: listStudents, enabled: authed });
  const options = useQuery({
    queryKey: ["messages", "recipients", about],
    queryFn: () => guardianMessageRecipients(about && about !== GENERAL ? about : null),
    enabled: authed && about !== null,
  });

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "guardian") return <Redirect href="/" />;

  async function send() {
    if (!recipient || !subject.trim() || (!body.trim() && photos.length === 0)) return setError("Choose who to write to, and fill in the subject and message.");
    setBusy(true);
    setError(null);
    try {
      const t = await guardianStartMessage({
        studentId: about && about !== GENERAL ? about : null,
        recipient,
        subject: subject.trim(),
        body: body.trim(),
        imageIds: photos.map((p) => p.id),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.guardianMessages });
      router.replace({ pathname: "/messages/[id]", params: { id: t.id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The message was not sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const childOptions = [
    ...(children.data?.data ?? []).map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` })),
    { value: GENERAL, label: "General" },
  ];

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Write a message" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Body muted>Only the person or office you choose will see it.</Body>
        {children.isLoading ? (
          <Skeleton lines={1} />
        ) : (
          <ChoiceChips
            label="About"
            options={childOptions}
            value={about}
            onChange={(v) => {
              setAbout(v);
              setRecipient(null);
            }}
          />
        )}
        {about !== null &&
          (options.isLoading ? (
            <Skeleton lines={1} />
          ) : (
            <ChoiceChips
              label="To"
              options={(options.data ?? []).map((o) => ({ value: o.recipient, label: o.name ? `${o.label} (${o.name})` : o.label }))}
              value={recipient}
              onChange={setRecipient}
            />
          ))}
        <TextField label="Subject" value={subject} onChangeText={setSubject} maxLength={MESSAGE_LIMITS.subject} />
        <TextField label="Message" value={body} onChangeText={setBody} multiline maxLength={MESSAGE_LIMITS.body} />
        <MessagePhotoPicker photos={photos} onChange={setPhotos} stage={guardianStageMessageImage} />
        <Caption>Conversations close after {MESSAGE_LIMITS.closeAfterDays} days without a new message.</Caption>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button title="Send" onPress={() => void send()} loading={busy} disabled={!recipient || !subject.trim() || (!body.trim() && photos.length === 0)} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
});
