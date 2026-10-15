import { StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { describeDisciplineNotice, formatDisciplineDate } from "@school-kit/types";

import { guardianDisciplineNotices } from "../lib/api/portal";
import { queryKeys } from "../lib/query/keys";
import { useTheme } from "../theme/theme-provider";
import { spacing } from "../theme/tokens";
import { Body, Caption, Card, Label } from "./ui";

// Phase 9 / CP2.3 — "Notices from the school" on a child's screen
// (docs/modules/phase-9.md §9 CP2-D4). Approved suspensions and exclusions
// only: the action, its dates and the day it was decided. Renders NOTHING when
// there are none or the read fails, so it can never break the child's screen.
// The student's own app has no equivalent.
export function DisciplineNotices({ studentId }: { studentId: string }) {
  const { colors } = useTheme();
  const query = useQuery({
    queryKey: queryKeys.disciplineNotices(studentId),
    queryFn: () => guardianDisciplineNotices(studentId),
    enabled: studentId !== "",
  });
  const notices = query.data?.data ?? [];
  if (notices.length === 0) return null;

  return (
    // A tint, not a coloured edge (CLAUDE.md: no accent borders), and the
    // heading says what it is in words.
    <Card style={{ backgroundColor: `${colors.warning}14` }}>
      <Label>Notices from the school</Label>
      {notices.map((n) => (
        <View key={n.id} style={styles.row}>
          <Body muted={n.withdrawnOn !== null}>
            {describeDisciplineNotice(n)}
            {n.withdrawnOn ? " (withdrawn)" : ""}
          </Body>
          <Caption>
            Decided on {formatDisciplineDate(n.decidedOn)}
            {n.withdrawnOn ? ` · Withdrawn on ${formatDisciplineDate(n.withdrawnOn)}` : ""}
          </Caption>
        </View>
      ))}
      <Caption>Please contact the school.</Caption>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
});
