import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { sickbayDayOf, sickbayMomentFrom } from "@school-kit/types";

import { DateBoxes, TextField, type DateBoxValues } from "../../../src/components/form";
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

function todayBoxes(): DateBoxValues {
  const [year, month, day] = sickbayDayOf(new Date()).split("-") as [string, string, string];
  return { day, month, year };
}

function isoDay(v: DateBoxValues): string | null {
  if (!v.day || !v.month || v.year.length !== 4) return null;
  return `${v.year}-${v.month.padStart(2, "0")}-${v.day.padStart(2, "0")}`;
}

export default function AskExeatScreen() {
  const { status, principal } = useSession();
  const { id: studentId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [outDay, setOutDay] = useState(todayBoxes);
  const [outTime, setOutTime] = useState("09:00");
  const [backDay, setBackDay] = useState(todayBoxes);
  const [backTime, setBackTime] = useState("18:00");
  const [reason, setReason] = useState("");
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "guardian") return <Redirect href="/me" />;

  async function submit() {
    const out = isoDay(outDay);
    const back = isoDay(backDay);
    if (!out || !back) return setError("Enter the days out and back in full.");
    if (!/^\d{2}:\d{2}$/.test(outTime) || !/^\d{2}:\d{2}$/.test(backTime)) return setError("Enter the times like 09:00 or 18:30.");
    if (!reason.trim() || !name.trim() || !relationship.trim() || !phone.trim()) {
      return setError("Fill in the reason and who will collect your child, with their phone number.");
    }
    setBusy(true);
    setError(null);
    try {
      await guardianAskExeat(studentId, {
        outAt: sickbayMomentFrom(out, outTime),
        backBy: sickbayMomentFrom(back, backTime),
        reason: reason.trim(),
        collectorName: name.trim(),
        collectorRelationship: relationship.trim(),
        collectorPhone: phone.trim(),
      });
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
        <DateBoxes label="Out on" value={outDay} onChange={setOutDay} />
        <TextField label="Out at (like 09:00)" value={outTime} onChangeText={setOutTime} maxLength={5} />
        <DateBoxes label="Back on" value={backDay} onChange={setBackDay} />
        <TextField label="Back by (like 18:00)" value={backTime} onChangeText={setBackTime} maxLength={5} />
        <TextField label="Reason" value={reason} onChangeText={setReason} maxLength={300} multiline />
        <TextField label="Who will collect" value={name} onChangeText={setName} maxLength={80} autoCapitalize="words" />
        <TextField label="Their relationship" value={relationship} onChangeText={setRelationship} maxLength={40} placeholder="Mother, uncle, driver" />
        <TextField label="Their phone" value={phone} onChangeText={setPhone} maxLength={20} keyboardType="phone-pad" />
        <Button title={busy ? "Sending…" : "Send request"} onPress={() => void submit()} disabled={busy} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, padding: spacing.md },
});
