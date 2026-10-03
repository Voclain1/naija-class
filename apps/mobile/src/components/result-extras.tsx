import { StyleSheet, Text, View } from "react-native";
import type { ReleasedResultDetailDto } from "@school-kit/types";

import { attendanceLine, cumulativeLine, promotionLabel } from "../lib/results/result-extras";
import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { Body, Card, Heading, Label } from "./ui";

// Phase 8 / CP6a — what a released card gained, shared by the guardian and the
// student result screens. Fields are read as possibly undefined: see
// src/lib/results/result-extras.ts on cards persisted before this change.

/** Promotion status (final term) and attendance. Renders nothing when neither is on the card. */
export function ResultStanding({ result }: { result: Partial<ReleasedResultDetailDto> }) {
  const { colors } = useTheme();
  const promotion = promotionLabel(result);
  const attendance = attendanceLine(result);
  const cumulative = cumulativeLine(result);
  if (!promotion && !attendance && !cumulative) return null;

  return (
    <>
      {promotion ? (
        // A tinted surface, never an accent border (CLAUDE.md) — and the
        // decision is said in words, not only in colour.
        <View style={[styles.promotion, { backgroundColor: `${colors.primary}1F` }]}>
          <Label>Promotion status</Label>
          <Text style={[styles.promotionValue, { color: colors.foreground }]}>{promotion}</Text>
        </View>
      ) : null}
      {cumulative ? (
        <Card>
          <Heading>The year so far</Heading>
          <Body>{cumulative}</Body>
        </Card>
      ) : null}
      {attendance ? (
        <Card>
          <Heading>Attendance</Heading>
          <Body>{attendance}</Body>
        </Card>
      ) : null}
    </>
  );
}

/** The principal's remark for the class — the same words the printed card carries. */
export function PrincipalRemark({ result }: { result: Partial<ReleasedResultDetailDto> }) {
  if (!result.principalNote) return null;
  return (
    <Card>
      <Heading>Principal&apos;s remark</Heading>
      <Body>{result.principalNote}</Body>
    </Card>
  );
}

const styles = StyleSheet.create({
  promotion: { borderRadius: radii.md, padding: spacing.md, gap: spacing.xs },
  promotionValue: { fontFamily: fonts.serif, fontSize: fontSizes.bodyLarge },
});
