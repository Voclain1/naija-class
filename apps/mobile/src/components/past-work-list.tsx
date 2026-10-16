import { StyleSheet, View } from "react-native";
import { describeWorkStatus, type AssignmentFileUrlDto, type FamilyAssignmentDto } from "@school-kit/types";

import { spacing } from "../theme/tokens";
import { SubmissionFiles } from "./submission-files";
import { Body, Button, Caption, Card, Label } from "./ui";

// Phase 9 / CP4.1 — collected work whose due date has left the homework list,
// which looks back only a few days. Marks usually arrive after that, so this is
// where a family finds them. The mark shows only once the teacher released it.

function formatDue(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function PastWorkList({
  items,
  onOpen,
  fileUrl,
}: {
  items: readonly FamilyAssignmentDto[];
  onOpen?: (homeworkId: string) => void;
  /** CP4.2 — the link call for a handed-in file. */
  fileUrl?: (fileId: string) => Promise<AssignmentFileUrlDto>;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.group}>
      <Label>Earlier work</Label>
      {items.map((w) => (
        <Card key={w.assignmentId}>
          <Body>{w.title}</Body>
          <Caption>
            {w.subjectName} · due {formatDue(w.dueDate)}
          </Caption>
          <Label>
            {describeWorkStatus(w.status)}
            {w.late && w.status !== "NOT_SUBMITTED" ? " · late" : ""}
            {w.mark !== null ? ` · ${w.mark}/${w.totalMarks}` : ""}
          </Label>
          {w.feedback ? <Caption>{w.feedback}</Caption> : null}
          {w.status === "RETURNED" && w.returnNote ? <Caption>Teacher: {w.returnNote}</Caption> : null}
          {fileUrl ? <SubmissionFiles files={w.files} getUrl={fileUrl} /> : null}
          {onOpen ? <Button title="Open" variant="secondary" onPress={() => onOpen(w.assignmentId)} /> : null}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm, marginTop: spacing.sm },
});
