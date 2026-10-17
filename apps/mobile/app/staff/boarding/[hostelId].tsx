import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatSickbayTime, sickbayDayOf, type HouseBoarderDto } from "@school-kit/types";

import { TextField } from "../../../src/components/form";
import { ListRow, ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Button, Caption, Card, Label, Notice, Screen } from "../../../src/components/ui";
import { ApiError } from "../../../src/lib/api/client";
import { staffHostelBoarders, staffHostelVisits, staffLogHostelVisit, staffVisitorLeft } from "../../../src/lib/api/staff-boarding";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP6b.2 — one hostel's boarders this term and today's visitors
// (docs/modules/phase-9.md §15 CP6b-D5, D7). The sickbay tells the house
// master only that a boarder was sent home today, never why (owner, §15.8).
// Tap a boarder to log a visitor arriving now; mark them gone when they leave.
// Confidential, and never kept on the phone (staff-prefixed query keys).

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

export default function HostelBoardingScreen() {
  const { hostelId } = useLocalSearchParams<{ hostelId: string }>();
  const queryClient = useQueryClient();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const today = sickbayDayOf(new Date());
  const [visiting, setVisiting] = useState<HouseBoarderDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const boarders = useQuery({
    queryKey: queryKeys.staffBoardingBoarders(schoolId, userId, hostelId ?? ""),
    queryFn: () => staffHostelBoarders(hostelId ?? ""),
    enabled: authed && !!hostelId,
  });
  const visitsKey = queryKeys.staffBoardingVisits(schoolId, userId, hostelId ?? "", today);
  const visits = useQuery({
    queryKey: visitsKey,
    queryFn: () => staffHostelVisits(hostelId ?? "", today),
    enabled: authed && !!hostelId,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  async function left(visitId: string) {
    setError(null);
    try {
      await staffVisitorLeft(visitId);
      await queryClient.invalidateQueries({ queryKey: visitsKey });
    } catch (e) {
      setError(message(e));
    }
  }

  const data = boarders.data;
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={boarders.isRefetching || visits.isRefetching}
            onRefresh={() => {
              void boarders.refetch();
              void visits.refetch();
            }}
          />
        }
      >
        <ScreenHeader title={data?.hostel.name ?? "Hostel"} subtitle={data?.term ? `Boarders · ${data.term.name}` : "Boarders"} />
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {visiting && hostelId ? (
          <LogVisitor
            hostelId={hostelId}
            boarder={visiting}
            onDone={async (logged) => {
              setVisiting(null);
              if (logged) await queryClient.invalidateQueries({ queryKey: visitsKey });
            }}
          />
        ) : null}

        <Label>Today&apos;s visitors</Label>
        {visits.isLoading ? (
          <Skeleton lines={2} />
        ) : visits.isError ? (
          <LoadError error={visits.error} what="visitors" onRetry={() => void visits.refetch()} />
        ) : (visits.data ?? []).length === 0 ? (
          <Body muted>No visitors logged today. Tap a boarder below to log one.</Body>
        ) : (
          (visits.data ?? []).map((v) => (
            <Card key={v.id}>
              <Body>
                {v.visitorName} ({v.relationship}) to see {v.studentName}
              </Body>
              <Caption>
                Arrived {formatSickbayTime(v.arrivedAt)} · {v.leftAt ? `Left ${formatSickbayTime(v.leftAt)}` : "Still here"}
                {v.phone ? ` · ${v.phone}` : ""}
              </Caption>
              {!v.leftAt ? <Button variant="secondary" title="Has left" onPress={() => void left(v.id)} /> : null}
            </Card>
          ))
        )}

        <Label>Boarders</Label>
        {boarders.isLoading ? (
          <Skeleton lines={4} />
        ) : boarders.isError ? (
          <LoadError error={boarders.error} what="boarders" onRetry={() => void boarders.refetch()} />
        ) : !data?.term ? (
          <Body muted>No term is set as current, so there are no boarders to show.</Body>
        ) : data.boarders.length === 0 ? (
          <Body muted>No boarders in this hostel this term.</Body>
        ) : (
          data.boarders.map((b) => (
            <View key={b.bedId} style={styles.boarder}>
              <ListRow
                icon="person-outline"
                title={b.studentName}
                subtitle={`${b.classArm ? `${b.classArm} · ` : ""}${b.roomName}, bed ${b.bedNumber}`}
                meta="Log a visitor"
                onPress={() => setVisiting(b)}
              />
              {b.sentHomeToday ? <Notice tone="warning">Sent home by the sickbay today</Notice> : null}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function LogVisitor({ hostelId, boarder, onDone }: { hostelId: string; boarder: HouseBoarderDto; onDone: (logged: boolean) => void }) {
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || !relationship.trim()) return setError("Enter the visitor's name and who they are to the child.");
    setBusy(true);
    setError(null);
    try {
      await staffLogHostelVisit(hostelId, {
        studentId: boarder.studentId,
        visitorName: name.trim(),
        relationship: relationship.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      onDone(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Label>A visitor for {boarder.studentName}, arriving now</Label>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <TextField label="Visitor's name" value={name} onChangeText={setName} maxLength={80} autoCapitalize="words" />
      <TextField label="Relationship" value={relationship} onChangeText={setRelationship} maxLength={40} placeholder="Mother, uncle, family friend" />
      <TextField label="Phone (optional)" value={phone} onChangeText={setPhone} maxLength={20} keyboardType="phone-pad" />
      <Button title={busy ? "Logging…" : "Log visitor"} onPress={() => void save()} disabled={busy} />
      <Button variant="secondary" title="Cancel" onPress={() => onDone(false)} disabled={busy} />
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  boarder: { gap: spacing.xs },
});
