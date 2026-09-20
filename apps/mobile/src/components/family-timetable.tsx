import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { formatCalendarDate, type FamilyTimetableDto } from "@school-kit/types";

import { spacing } from "../theme/tokens";
import { Body, Button, Card, Heading } from "./ui";
import { TimetableDays } from "./timetable-days";
import { TimetableGrid } from "./timetable-grid";

// A published CLASS timetable, for a student reading their own and a guardian
// reading their child's.
//
// TABLE is the default, because that is what a school timetable is: days
// across, periods down, subjects aligned, exactly as it appears on a classroom
// wall. Reading down a column answers "what follows Maths on Tuesday", which a
// day-by-day list cannot do at all.
//
// The day list is kept as the second view rather than deleted. It fits without
// sideways scrolling, it reads aloud sensibly for accessibility, and "what is
// on tomorrow" is a real question. Neither view is a compromise for the other.

const EMPTY: Record<
  Exclude<FamilyTimetableDto["state"], "PUBLISHED">,
  { title: string; body: (d: FamilyTimetableDto) => string }
> = {
  NO_CURRENT_TERM: {
    title: "No current term",
    body: () => "The school hasn't set the current term yet.",
  },
  NOT_ENROLLED: {
    title: "No class this term",
    body: (d) => `There is no class timetable for ${d.termName ?? "this term"}.`,
  },
  NOT_PUBLISHED: {
    title: "Not published yet",
    body: (d) => `The school hasn't published a timetable for ${d.className ?? "this class"} yet.`,
  },
};

export function FamilyTimetable({
  data,
  showTeachers = true,
}: {
  data: FamilyTimetableDto;
  showTeachers?: boolean;
}) {
  const [view, setView] = useState<"table" | "day">("table");

  if (data.state !== "PUBLISHED" || !data.grid) {
    const empty = EMPTY[data.state as keyof typeof EMPTY];
    return (
      <Card>
        <Heading>{empty.title}</Heading>
        <Body muted>{empty.body(data)}</Body>
      </Card>
    );
  }

  const grid = data.grid;
  const lessonByKey = new Map(
    grid.lessons.map((lesson) => [`${lesson.dayOfWeek}:${lesson.slotPosition}`, lesson]),
  );

  return (
    <>
      <Body muted>
        {data.className} · {data.termName}
        {data.publishedAt ? ` · published ${formatCalendarDate(data.publishedAt.slice(0, 10))}` : ""}
      </Body>

      <View style={styles.toggle}>
        <Button
          title="Table"
          variant={view === "table" ? "primary" : "secondary"}
          onPress={() => setView("table")}
        />
        <Button
          title="By day"
          variant={view === "day" ? "primary" : "secondary"}
          onPress={() => setView("day")}
        />
      </View>

      {view === "table" ? (
        <TimetableGrid
          days={grid.days}
          slots={grid.slots}
          showTeachers={showTeachers}
          lessonAt={(day, position) => {
            const lesson = lessonByKey.get(`${day}:${position}`);
            return lesson
              ? { subjectName: lesson.subjectName, teacherNames: lesson.teacherNames }
              : null;
          }}
        />
      ) : (
        <TimetableDays data={data} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: "row", gap: spacing.sm, paddingTop: spacing.sm },
});
