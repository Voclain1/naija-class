import { Linking, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { formatMinuteOfDay } from "@school-kit/types";

import { guardianTransport } from "../lib/api/portal";
import { queryKeys } from "../lib/query/keys";
import { spacing } from "../theme/tokens";
import { Body, Button, Card, Label } from "./ui";

// Phase 9 / CP5.3 — the child's school bus this term on a parent's child
// screen (docs/modules/phase-9.md §13 CP5-D10): route, stop, pickup time,
// driver and bus. Absent when the child has no place, or the read fails.
export function TransportCard({ studentId }: { studentId: string }) {
  const query = useQuery({
    queryKey: queryKeys.studentTransport(studentId),
    queryFn: () => guardianTransport(studentId),
    enabled: studentId !== "",
  });
  const t = query.data;
  if (!t) return null;
  return (
    <Card>
      <Label>School bus · {t.termName}</Label>
      <View style={styles.rows}>
        <Body>{t.routeName}</Body>
        <Body muted>
          {t.stopName}
          {t.pickupMinute !== null ? ` · pickup ${formatMinuteOfDay(t.pickupMinute)}` : ""}
        </Body>
        {t.vehiclePlate ? <Body muted>Bus {t.vehiclePlate}</Body> : null}
        {t.driverName ? <Body muted>Driver: {t.driverName}</Body> : null}
      </View>
      {t.driverPhone ? (
        <Button
          variant="secondary"
          title={`Call the driver (${t.driverPhone})`}
          onPress={() => void Linking.openURL(`tel:${t.driverPhone}`)}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  rows: { gap: spacing.xs },
});
