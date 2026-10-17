import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatSickbayDay, formatSickbayTime, HOSTEL_EXEAT_STATUS_LABEL, type PortalHostelExeatDto } from "@school-kit/types";

import { guardianCancelExeat, guardianExeats, guardianHostel } from "../lib/api/portal";
import { queryKeys } from "../lib/query/keys";
import { spacing } from "../theme/tokens";
import { Body, Button, Caption, Card, Label, Notice } from "./ui";

// Phase 9 / CP6b.2 — the child's hostel this term on a parent's child screen
// (docs/modules/phase-9.md §15 CP6b-D8): hostel, room, bed and the house
// masters' names. No phones, no visitor log (owner, §15.8). Absent when the
// child is not a boarder, or the read fails.
//
// Phase 9 / CP6b.3 — and the child's leave out (exeats): the latest few, each
// status in words, the school's note on a refusal, "Late back" when the child
// is out past the time agreed; cancel until the child has left; ask for one.

function moment(at: string | Date): string {
  return `${formatSickbayDay(at)}, ${formatSickbayTime(at)}`;
}

export function HostelCard({ studentId }: { studentId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.studentHostel(studentId),
    queryFn: () => guardianHostel(studentId),
    enabled: studentId !== "",
  });
  const exeats = useQuery({
    queryKey: queryKeys.studentExeats(studentId),
    queryFn: () => guardianExeats(studentId),
    enabled: studentId !== "" && !!query.data,
  });
  const h = query.data;
  if (!h) return null;

  async function cancel(e: PortalHostelExeatDto) {
    await guardianCancelExeat(studentId, e.id).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: queryKeys.studentExeats(studentId) });
  }

  return (
    <Card>
      <Label>Hostel · {h.termName}</Label>
      <View style={styles.rows}>
        <Body>{h.hostelName}</Body>
        <Body muted>
          {h.roomName}, bed {h.bedNumber}
        </Body>
        {h.houseMasters.length > 0 ? (
          <Body muted>
            {h.houseMasters.length === 1 ? "House master" : "House masters"}: {h.houseMasters.join(", ")}
          </Body>
        ) : null}
      </View>
      <Label>Leave out</Label>
      {(exeats.data ?? []).slice(0, 5).map((e) => (
        <View key={e.id} style={styles.exeat}>
          {e.late ? <Notice tone="danger">Late back: was due {moment(e.backBy)}</Notice> : null}
          <Body>{HOSTEL_EXEAT_STATUS_LABEL[e.status]}</Body>
          <Caption>
            Out {moment(e.outAt)} · back by {moment(e.backBy)}
          </Caption>
          <Caption>Collected by {e.collectedBy ?? `${e.collector.name} (${e.collector.relationship})`}</Caption>
          {e.decisionNote ? <Caption>School&apos;s note: {e.decisionNote}</Caption> : null}
          {e.canCancel ? <Button variant="secondary" title="Cancel this leave out" onPress={() => void cancel(e)} /> : null}
        </View>
      ))}
      {exeats.data && exeats.data.length === 0 ? <Body muted>No leave out asked for yet.</Body> : null}
      <Button title="Ask for leave out" onPress={() => router.push(`/students/${studentId}/exeat`)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  rows: { gap: spacing.xs },
  exeat: { gap: spacing.xs },
});
