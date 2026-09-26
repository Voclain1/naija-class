import { StyleSheet, Text, View } from "react-native";
import type { HomeworkFeedItemDto } from "@school-kit/types";

import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { groupHomework } from "../lib/family/homework";
import { Body, Card, Heading, Label } from "./ui";

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
}: {
  items: readonly HomeworkFeedItemDto[];
  today: string;
  tomorrow: string;
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
          {group.items.map((item) => (
            <Card key={item.id}>
              <View style={styles.row}>
                <View style={styles.titleRow}>
                  <Heading>{item.title}</Heading>
                  {group.overdue ? (
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
              </View>
            </Card>
          ))}
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
});
