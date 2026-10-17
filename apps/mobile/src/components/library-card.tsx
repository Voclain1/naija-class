import { StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { FamilyLibraryLoanDto } from "@school-kit/types";

import { guardianLibrary } from "../lib/api/portal";
import { queryKeys } from "../lib/query/keys";
import { useTheme } from "../theme/theme-provider";
import { radii, spacing } from "../theme/tokens";
import { Body, Card, Label } from "./ui";

// Phase 9 / CP6.2 — the library books a child has out and when each is due
// (docs/modules/phase-9.md §14 CP6-D6), on a parent's child screen and the
// student's own Library screen. A late book is tinted AND says "Overdue" in
// words. Fines reach the family as a line on their fees, not here.

/** "17 Oct 2026" for a YYYY-MM-DD date. */
export function formatLibraryDay(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00.000Z`),
  );
}

export function LibraryLoanRows({ loans }: { loans: FamilyLibraryLoanDto[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.rows}>
      {loans.map((l) => (
        <View key={l.id} style={[styles.row, l.overdue ? { backgroundColor: `${colors.warning}1F` } : null]}>
          <Body>{l.title}</Body>
          <Body muted>
            {l.overdue
              ? `Overdue by ${l.daysLate} ${l.daysLate === 1 ? "day" : "days"} (due ${formatLibraryDay(l.dueOn)})`
              : `Due ${formatLibraryDay(l.dueOn)}`}
          </Body>
        </View>
      ))}
    </View>
  );
}

export function LibraryCard({ studentId }: { studentId: string }) {
  const query = useQuery({
    queryKey: queryKeys.studentLibrary(studentId),
    queryFn: () => guardianLibrary(studentId),
    enabled: studentId !== "",
  });
  const loans = query.data?.loans ?? [];
  if (loans.length === 0) return null;
  return (
    <Card>
      <Label>Library books</Label>
      <LibraryLoanRows loans={loans} />
    </Card>
  );
}

const styles = StyleSheet.create({
  rows: { gap: spacing.sm },
  row: { gap: spacing.xs, borderRadius: radii.sm, padding: spacing.xs },
});
