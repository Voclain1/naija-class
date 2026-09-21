import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { CalendarEntryDto } from "@school-kit/types";

import { spacing } from "../theme/tokens";
import { Button } from "./ui";
import { CalendarList } from "./calendar-list";
import { CalendarMonth } from "./calendar-month";

// The calendar, in the two shapes people expect: a month grid and a list.
//
// MONTH is the default. A calendar question is usually about a date — is the
// 16th free, when does the break start, how far away are exams — and a list
// makes you count to answer it.
//
// LIST is kept as the second view because it answers the other question,
// "what is coming up next", without tapping through days; it also reads aloud
// in order for anyone using a screen reader, which a grid does not.
//
// Shared by the teacher, guardian and student screens so a holiday looks and
// reads the same for a teacher, a parent and a child. The three differ only in
// which endpoint feeds them, which is a session and permission matter, not a
// presentation one.

interface Props {
  entries: CalendarEntryDto[];
  month: string;
  selectedDate: string | null;
  today: string | null;
  onSelectDate: (date: string) => void;
  onChangeMonth: (month: string) => void;
  /** Offered on entries `isEditable` accepts — the staff calendar passes it for owners/admins. */
  onEditEntry?: (entry: CalendarEntryDto) => void;
  isEditable?: (entry: CalendarEntryDto) => boolean;
}

export function CalendarView({
  entries,
  month,
  selectedDate,
  today,
  onSelectDate,
  onChangeMonth,
  onEditEntry,
  isEditable,
}: Props) {
  const [view, setView] = useState<"month" | "list">("month");

  return (
    <>
      <View style={styles.toggle}>
        <Button
          title="Month"
          variant={view === "month" ? "primary" : "secondary"}
          onPress={() => setView("month")}
        />
        <Button
          title="List"
          variant={view === "list" ? "primary" : "secondary"}
          onPress={() => setView("list")}
        />
      </View>

      {view === "month" ? (
        <CalendarMonth
          entries={entries}
          month={month}
          selectedDate={selectedDate}
          today={today}
          onSelectDate={onSelectDate}
          onChangeMonth={onChangeMonth}
          onEditEntry={onEditEntry}
          isEditable={isEditable}
        />
      ) : (
        // The list shows the loaded window, which is the month on screen —
        // the same entries the grid is drawing, never a wider set the user
        // did not ask for.
        <CalendarList entries={entries} onEditEntry={onEditEntry} isEditable={isEditable} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: "row", gap: spacing.sm, paddingTop: spacing.sm },
});
