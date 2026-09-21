import { StyleSheet, View } from "react-native";
import {
  CALENDAR_CATEGORY_LABELS,
  formatCalendarMonth,
  formatCalendarRange,
  groupCalendarEntriesByMonth,
  type CalendarEntryDto,
} from "@school-kit/types";

import { spacing } from "../theme/tokens";
import { Body, Button, Card, Heading, Label, Notice } from "./ui";

// Phase 8 / CP1 — the school calendar as an agenda, grouped by month (D30).
// Shared by the guardian and student screens: both render the SAME merged
// calendar the API builds in one place (D27), so they share one renderer too.
//
// Dates are formatted by @school-kit/types' fixed-offset helpers, not Intl —
// Hermes' Intl support is not something a holiday date should depend on.
export function CalendarList({
  entries,
  onEditEntry,
  isEditable,
}: {
  entries: CalendarEntryDto[];
  onEditEntry?: (entry: CalendarEntryDto) => void;
  isEditable?: (entry: CalendarEntryDto) => boolean;
}) {
  if (entries.length === 0) {
    return (
      <Card>
        <Heading>Nothing coming up</Heading>
        <Body muted>There is nothing on the school calendar for this period.</Body>
      </Card>
    );
  }

  return (
    <>
      {groupCalendarEntriesByMonth(entries).map((group) => (
        <Card key={group.month}>
          <Heading>{formatCalendarMonth(`${group.month}-01`)}</Heading>
          {group.entries.map((e) => (
            <View key={e.id} style={styles.entry} accessibilityLabel={`${e.title}, ${formatCalendarRange(e.startDate, e.endDate)}`}>
              <Label>{formatCalendarRange(e.startDate, e.endDate)}</Label>
              <Body>{e.title}</Body>
              <Body muted>{CALENDAR_CATEGORY_LABELS[e.category]}</Body>
              {!e.dateConfirmed ? (
                <Notice tone="warning">Expected — the exact date has not been announced yet.</Notice>
              ) : null}
              {e.description ? <Body muted>{e.description}</Body> : null}
              {onEditEntry && isEditable?.(e) ? (
                <Button title="Edit event" variant="secondary" onPress={() => onEditEntry(e)} />
              ) : null}
            </View>
          ))}
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  entry: { marginTop: spacing.sm, gap: spacing.xs },
});
