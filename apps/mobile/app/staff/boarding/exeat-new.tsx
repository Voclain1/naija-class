import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ChoiceChips, DateBoxes, TextField } from "../../../src/components/form";
import { ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Button, Notice, Screen } from "../../../src/components/ui";
import { ApiError } from "../../../src/lib/api/client";
import { staffHostelBoarders, staffRecordExeat } from "../../../src/lib/api/staff-boarding";
import { useSession } from "../../../src/lib/auth/session";
import { blankExeatForm, exeatFormInput } from "../../../src/lib/hostels/exeat-form";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP11.2 — a leave-out request a parent made by phone or in person,
// recorded by the house master, as on the website (docs/modules/phase-9.md
// §20). It arrives as "waiting" and is approved on the hostel screen, like a
// parent's own request.

export default function RecordExeatScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, principal, staff } = useSession();
  const { hostelId } = useLocalSearchParams<{ hostelId: string }>();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const [studentId, setStudentId] = useState<string | null>(null);
  const [form, setForm] = useState(() => blankExeatForm());
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boarders = useQuery({
    queryKey: queryKeys.staffBoardingBoarders(schoolId, userId, hostelId ?? ""),
    queryFn: () => staffHostelBoarders(hostelId ?? ""),
    enabled: authed && !!hostelId,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  async function submit() {
    if (!studentId) return setError("Choose the boarder.");
    const checked = exeatFormInput(form);
    if ("error" in checked) return setError(checked.error);
    setBusy(true);
    setError(null);
    try {
      await staffRecordExeat(hostelId ?? "", { studentId, ...checked.input });
      await queryClient.invalidateQueries({ queryKey: queryKeys.staffBoardingExeats(schoolId, userId, hostelId ?? "").slice(0, 5) });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record the request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const list = boarders.data?.boarders ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Record a leave out request" subtitle={boarders.data?.hostel.name} />
        <Body muted>For a request a parent made by phone or in person. It waits for approval like any other.</Body>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {boarders.isLoading ? (
          <Skeleton lines={3} />
        ) : boarders.isError ? (
          <LoadError error={boarders.error} what="boarders" onRetry={() => void boarders.refetch()} />
        ) : list.length === 0 ? (
          <Body muted>No boarders in this hostel this term.</Body>
        ) : (
          <ChoiceChips label="Boarder" options={list.map((b) => ({ value: b.studentId, label: b.studentName }))} value={studentId} onChange={setStudentId} />
        )}
        <DateBoxes label="Out on" value={form.outDay} onChange={set("outDay")} />
        <TextField label="Out at (like 09:00)" value={form.outTime} onChangeText={set("outTime")} maxLength={5} />
        <DateBoxes label="Back on" value={form.backDay} onChange={set("backDay")} />
        <TextField label="Back by (like 18:00)" value={form.backTime} onChangeText={set("backTime")} maxLength={5} />
        <TextField label="Reason" value={form.reason} onChangeText={set("reason")} maxLength={300} multiline />
        <TextField label="Who will collect" value={form.collectorName} onChangeText={set("collectorName")} maxLength={80} autoCapitalize="words" />
        <TextField label="Their relationship" value={form.collectorRelationship} onChangeText={set("collectorRelationship")} maxLength={40} placeholder="Mother, uncle, driver" />
        <TextField label="Their phone" value={form.collectorPhone} onChangeText={set("collectorPhone")} maxLength={20} keyboardType="phone-pad" />
        <Button title={busy ? "Recording…" : "Record request"} onPress={() => void submit()} disabled={busy} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md, paddingBottom: spacing.xl },
});
