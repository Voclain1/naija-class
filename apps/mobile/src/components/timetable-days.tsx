import { StyleSheet, View } from "react-native";
import {
  ISO_WEEKDAY_LABELS,
  formatMinuteOfDay,
  publishedDay,
  type FamilyTimetableDto,
} from "@school-kit/types";

import { spacing } from "../theme/tokens";
import { Body, Card, Heading, Label } from "./ui";

// Phase 8 / CP4 — a class timetable for families, one card per school day
// (docs/modules/phase-8.md §18 D39, D45). Shared by the student and guardian
// screens: both read THE family reader, which returns only what the school
// PUBLISHED, so they share one renderer too. Doubles are merged by the same
// pure helper the portal uses (publishedDay).

const EMPTY: Record<Exclude<FamilyTimetableDto["state"], "PUBLISHED">, { title: string; body: (d: FamilyTimetableDto) => string }> = {
  NO_CURRENT_TERM: { title: "No current term", body: () => "The school hasn't set the current term yet." },
  NOT_ENROLLED: { title: "No class this term", body: (d) => `There is no class timetable for ${d.termName ?? "this term"}.` },
  NOT_PUBLISHED: {
    title: "Not published yet",
    body: (d) => `The school hasn't published a timetable for ${d.className ?? "this class"} yet.`,
  },
};

export function TimetableDays({ data }: { data: FamilyTimetableDto }) {
  if (data.state !== "PUBLISHED" || !data.grid) {
    const empty = EMPTY[data.state as keyof typeof EMPTY];
    return (
      <Card>
        <Heading>{empty.title}</Heading>
        <Body muted>{empty.body(data)}</Body>
      </Card>
    );
  }

  return (
    <>
      {data.grid.days.map((day) => (
        <Card key={day}>
          <Heading>{ISO_WEEKDAY_LABELS[day]}</Heading>
          {publishedDay(data.grid!, day).map((row) => {
            const time = `${formatMinuteOfDay(row.slot.startMinute)}–${formatMinuteOfDay(row.endMinute)}`;
            const title = row.slot.kind !== "LESSON" ? row.slot.label : row.lesson ? row.lesson.subjectName : `${row.slot.label} — free`;
            return (
              <View key={`${day}-${row.slot.position}`} style={styles.row} accessibilityLabel={`${time}, ${title}`}>
                <Label>{time}</Label>
                <Body muted={row.slot.kind !== "LESSON" || !row.lesson}>{title}</Body>
                {row.lesson && row.lesson.teacherNames.length > 0 ? <Body muted>{row.lesson.teacherNames.join(", ")}</Body> : null}
              </View>
            );
          })}
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: spacing.sm, gap: spacing.xs },
});
