import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { DateBoxes, TextField } from "../../../src/components/form";
import { blankExeatForm, exeatFormInput } from "../../../src/lib/hostels/exeat-form";
import { Body, Button, Notice, Screen } from "../../../src/components/ui";
import { ApiError } from "../../../src/lib/api/client";
import { guardianAskExeat } from "../../../src/lib/api/portal";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP6b.3 — a parent asks for their boarder's leave out
// (docs/modules/phase-9.md §15 CP6b-D6): the day and time out and back, the
// reason, and who will collect the child. The house master decides and the
// parent is told. Days are three number boxes, never a picker (form rule 2).

export default function AskExeatScreen() {
  const { status, principal } = useSession();
  const { id: studentId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => blankExeatForm());
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "guardian") return <Redirect href="/me" />;

  async function submit() {
    const checked = exeatFormInput(form);
    if ("error" in checked) return setError(checked.error);
    setBusy(true);
    setError(null);
    try {
      await guardianAskExeat(studentId, checked.input);
      await queryClient.invalidateQueries({ queryKey: queryKeys.studentExeats(studentId) });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Ask for leave out" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Body muted>The house master will approve or refuse it, and you will be told.</Body>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <DateBoxes label="Out on" value={form.outDay} onChange={set("outDay")} />
        <TextField label="Out at (like 09:00)" value={form.outTime} onChangeText={set("outTime")} maxLength={5} />
        <DateBoxes label="Back on" value={form.backDay} onChange={set("backDay")} />
        <TextField label="Back by (like 18:00)" value={form.backTime} onChangeText={set("backTime")} maxLength={5} />
        <TextField label="Reason" value={form.reason} onChangeText={set("reason")} maxLength={300} multiline />
        <TextField label="Who will collect" value={form.collectorName} onChangeText={set("collectorName")} maxLength={80} autoCapitalize="words" />
        <TextField label="Their relationship" value={form.collectorRelationship} onChangeText={set("collectorRelationship")} maxLength={40} placeholder="Mother, uncle, driver" />
        <TextField label="Their phone" value={form.collectorPhone} onChangeText={set("collectorPhone")} maxLength={20} keyboardType="phone-pad" />
        <Button title={busy ? "Sending…" : "Send request"} onPress={() => void submit()} disabled={busy} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, padding: spacing.md },
});
