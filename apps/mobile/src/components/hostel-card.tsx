import { StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { guardianHostel } from "../lib/api/portal";
import { queryKeys } from "../lib/query/keys";
import { spacing } from "../theme/tokens";
import { Body, Card, Label } from "./ui";

// Phase 9 / CP6b.2 — the child's hostel this term on a parent's child screen
// (docs/modules/phase-9.md §15 CP6b-D8): hostel, room, bed and the house
// masters' names. No phones, no visitor log (owner, §15.8). Absent when the
// child is not a boarder, or the read fails.
export function HostelCard({ studentId }: { studentId: string }) {
  const query = useQuery({
    queryKey: queryKeys.studentHostel(studentId),
    queryFn: () => guardianHostel(studentId),
    enabled: studentId !== "",
  });
  const h = query.data;
  if (!h) return null;
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
    </Card>
  );
}

const styles = StyleSheet.create({
  rows: { gap: spacing.xs },
});
