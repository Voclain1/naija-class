import { StyleSheet, Text, View } from "react-native";
import {
  describeWorkStatus,
  type AssignmentFileUrlDto,
  type FamilyAssignmentDto,
  type HomeworkFeedItemDto,
} from "@school-kit/types";

import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { groupHomework } from "../lib/family/homework";
import { SubmissionFiles } from "./submission-files";
import { Body, Button, Caption, Card, Heading, Label } from "./ui";

// Homework as a family reads it (docs/modules/the-school-day.md Part B).
// Shared by the student and parent screens, like AnnouncementFeed: the same
// shape from two endpoints, so one renderer and no drift.
//
// Grouped by WHEN, not by subject. A child at a kitchen table is answering
// "what must I do tonight?", and a subject-first list makes them read all of
// it to find out. Overdue first, because that is the part someone needs to
// know about; then today, tomorrow, and the rest by date.
//
// The ordering itself is lib/family/homework.ts, which is react-native-free
// so a spec can reach it.
//
// `overdue` comes from the server, computed against the school's day — never
// from the handset's clock, which can be wrong and would make the app accuse a
// child of being late.

export function HomeworkList({
  items,
  today,
  tomorrow,
  work,
  onOpenWork,
  fileUrl,
}: {
  items: readonly HomeworkFeedItemDto[];
  today: string;
  tomorrow: string;
  /**
   * Phase 9 / CP4.1 — where the child stands on each item that collects work,
   * keyed by homework id. The mark is in it only once the teacher released it.
   */
  work?: ReadonlyMap<string, FamilyAssignmentDto>;
  /** The student's own screen: open an item to hand work in or read it. */
  onOpenWork?: (homeworkId: string) => void;
  /** CP4.2 — the link call for a handed-in file, when this viewer may open files. */
  fileUrl?: (fileId: string) => Promise<AssignmentFileUrlDto>;
}) {
  const { colors } = useTheme();

  return (
    <>
      {groupHomework(items, today, tomorrow).map((group) => (
        <View key={group.label} style={styles.group}>
          <Text
            style={[
              styles.groupLabel,
              { color: group.overdue ? colors.danger : colors.mutedForeground },
            ]}
          >
            {group.label}
          </Text>
          {group.items.map((item) => {
            const w = work?.get(item.id);
            // Work handed in is not "late homework", whatever the date says.
            const handedIn = w !== undefined && w.status !== "NOT_SUBMITTED" && w.status !== "RETURNED";
            return (
            <Card key={item.id}>
              <View style={styles.row}>
                <View style={styles.titleRow}>
                  <Heading>{item.title}</Heading>
                  {group.overdue && !handedIn ? (
                    <View style={[styles.badge, { backgroundColor: colors.danger }]}>
                      <Text style={[styles.badgeText, { color: colors.background }]}>Late</Text>
                    </View>
                  ) : null}
                </View>
                <Label>
                  {item.subjectName}
                  {item.postedByName ? ` · ${item.postedByName}` : ""}
                </Label>
                {item.instructions ? <Body>{item.instructions}</Body> : null}
                {w ? (
                  <View style={[styles.work, { backgroundColor: `${colors.primary}12` }]}>
                    <Label>
                      {describeWorkStatus(w.status)}
                      {w.late && w.status !== "NOT_SUBMITTED" ? " · late" : ""}
                      {w.mark !== null ? ` · ${w.mark}/${w.totalMarks}` : ""}
                    </Label>
                    {w.feedback ? <Caption>{w.feedback}</Caption> : null}
                    {w.status === "RETURNED" && w.returnNote ? <Caption>Teacher: {w.returnNote}</Caption> : null}
                    {fileUrl ? <SubmissionFiles files={w.files} getUrl={fileUrl} /> : null}
                  </View>
                ) : null}
                {item.collectsWork && onOpenWork ? (
                  <Button
                    title={w && w.status !== "NOT_SUBMITTED" && w.status !== "RETURNED" ? "View my work" : "Hand in work"}
                    variant="secondary"
                    onPress={() => onOpenWork(item.id)}
                  />
                ) : null}
              </View>
            </Card>
            );
          })}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xs },
  groupLabel: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption, marginTop: spacing.sm },
  row: { gap: spacing.xs },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  badge: { borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption },
  work: { gap: spacing.xs, padding: spacing.sm, borderRadius: radii.sm },
});
