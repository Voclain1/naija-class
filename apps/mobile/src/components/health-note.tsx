import { StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { staffClassHealthNotes, staffHealthNote } from "../lib/api/staff-health";
import { queryKeys } from "../lib/query/keys";
import { useTheme } from "../theme/theme-provider";
import { spacing } from "../theme/tokens";
import { Body, Caption, Card, Label } from "./ui";

// Phase 9 / CP3.1 — the "For teachers" health note (docs/modules/phase-9.md
// §10 CP3-D2): the only health information a teacher sees. Tinted, with the
// words "Health note", never an edge stripe. Renders nothing when there is no
// note or the read fails.

export function StudentHealthNote({ studentId, schoolId, userId }: { studentId: string; schoolId: string; userId: string }) {
  const { colors } = useTheme();
  const query = useQuery({
    queryKey: queryKeys.staffHealthNote(schoolId, userId, studentId),
    queryFn: () => staffHealthNote(studentId),
    enabled: studentId !== "" && schoolId !== "",
  });
  const note = query.data?.note;
  if (!note) return null;
  return (
    <Card style={{ backgroundColor: `${colors.warning}1F` }}>
      <Label>Health note</Label>
      <Body>{note}</Body>
      <Caption>Shared with teachers by the school&apos;s health officer.</Caption>
    </Card>
  );
}

export function ClassHealthNotes({ armId, schoolId, userId }: { armId: string; schoolId: string; userId: string }) {
  const { colors } = useTheme();
  const query = useQuery({
    queryKey: queryKeys.staffClassHealthNotes(schoolId, userId, armId),
    queryFn: () => staffClassHealthNotes(armId),
    enabled: armId !== "" && schoolId !== "",
  });
  const notes = query.data?.data ?? [];
  if (notes.length === 0) return null;
  return (
    <Card style={{ backgroundColor: `${colors.warning}1F` }}>
      <Label>Health notes ({notes.length})</Label>
      {notes.map((n) => (
        <View key={n.studentId} style={styles.row}>
          <Body>{n.name}</Body>
          <Caption>{n.note}</Caption>
        </View>
      ))}
      <Caption>Shared with teachers by the school&apos;s health officer.</Caption>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
});
