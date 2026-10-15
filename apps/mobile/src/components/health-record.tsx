import { Alert, Linking, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { PortalHealthProfileDto } from "@school-kit/types";

import { guardianHealthRecord, guardianVaccinationDocumentUrl } from "../lib/api/portal";
import { queryKeys } from "../lib/query/keys";
import { spacing } from "../theme/tokens";
import { Body, Button, Caption, Card, Label } from "./ui";

// Phase 9 / CP3.1 — the child's health record on a parent's child screen
// (docs/modules/phase-9.md §10 CP3-D3). Read-only, never written to the
// phone's storage, and absent when the read fails.

type TextKey = Exclude<keyof PortalHealthProfileDto, "vaccinations" | "updatedAt">;

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const ROWS: { key: TextKey; label: string }[] = [
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

  // Phase 9 / CP3.2 — the document is private: a five-minute link, opened at once.
  async function view(vaccinationId: string): Promise<void> {
    try {
      const { url } = await guardianVaccinationDocumentUrl(studentId, vaccinationId);
      await Linking.openURL(url);
    } catch {
      Alert.alert("Can't open the document", "Check your connection and try again.");
    }
  }

  return (
    <Card>
      <Label>Health record</Label>
      {recorded.length === 0 && profile.vaccinations.length === 0 ? (
        <Body muted>The school has not recorded anything yet.</Body>
      ) : (
        recorded.map((r) => (
          <View key={r.key} style={styles.row}>
            <Caption>{r.label}</Caption>
            <Body>{String(profile[r.key])}</Body>
          </View>
        ))
      )}
      {profile.vaccinations.length > 0 ? (
        <View style={styles.row}>
          <Caption>Vaccinations</Caption>
          {profile.vaccinations.map((v) => (
            <View key={v.id} style={styles.row}>
              <Body>
                {v.name} · {formatDay(v.givenOn)}
              </Body>
              {v.documentType ? (
                <Button
                  title={`View ${v.documentType === "pdf" ? "PDF" : "photo"}`}
                  variant="secondary"
                  onPress={() => void view(v.id)}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <Caption>Something wrong or missing? Please contact the school.</Caption>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
});
