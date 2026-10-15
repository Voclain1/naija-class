import { StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { PortalHealthProfileDto } from "@school-kit/types";

import { guardianHealthRecord } from "../lib/api/portal";
import { queryKeys } from "../lib/query/keys";
import { spacing } from "../theme/tokens";
import { Body, Caption, Card, Label } from "./ui";

// Phase 9 / CP3.1 — the child's health record on a parent's child screen
// (docs/modules/phase-9.md §10 CP3-D3). Read-only, never written to the
// phone's storage, and absent when the read fails.

const ROWS: { key: keyof PortalHealthProfileDto; label: string }[] = [
  { key: "allergies", label: "Allergies" },
  { key: "conditions", label: "Conditions" },
  { key: "medication", label: "Medication" },
  { key: "gpClinic", label: "GP or clinic" },
  { key: "emergencyNotes", label: "Emergency notes" },
  { key: "bloodGroup", label: "Blood group" },
  { key: "teacherNote", label: "Shared with teachers" },
];

export function HealthRecord({ studentId }: { studentId: string }) {
  const query = useQuery({
    queryKey: queryKeys.healthRecord(studentId),
    queryFn: () => guardianHealthRecord(studentId),
    enabled: studentId !== "",
    meta: { persist: false },
  });
  const profile = query.data;
  if (!profile) return null;
  const recorded = ROWS.filter((r) => profile[r.key]);

  return (
    <Card>
      <Label>Health record</Label>
      {recorded.length === 0 ? (
        <Body muted>The school has not recorded anything yet.</Body>
      ) : (
        recorded.map((r) => (
          <View key={r.key} style={styles.row}>
            <Caption>{r.label}</Caption>
            <Body>{String(profile[r.key])}</Body>
          </View>
        ))
      )}
      <Caption>Something wrong or missing? Please contact the school.</Caption>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
});
