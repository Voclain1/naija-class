import { StyleSheet, Text, View } from "react-native";

import { FEE_RISK_LEVEL_LABELS, feeRiskReasonText, type FeeRiskDto } from "@school-kit/types";

import { useTheme } from "../theme/theme-provider";
import { fontSizes, radii, spacing } from "../theme/tokens";
import { Label } from "./ui";

// Phase 9 / CP10.2 — a debtor row's fee-default risk: the level as a word on
// a tinted background (never an accent border), and the reasons below it.
// For staff who read the debtor list only; families never see it.
export function FeeRiskTag({ risk }: { risk: FeeRiskDto }) {
  const { colors } = useTheme();
  const tint =
    risk.level === "HIGH" ? colors.danger : risk.level === "WATCH" ? colors.warning : risk.level === "LOW" ? colors.primary : colors.mutedForeground;
  return (
    <View style={styles.wrap}>
      <View style={[styles.tag, { backgroundColor: `${tint}26` }]}>
        <Text style={[styles.text, { color: colors.foreground }]}>Risk: {FEE_RISK_LEVEL_LABELS[risk.level]}</Text>
      </View>
      {risk.reasons.map((r, i) => (
        <Label key={i}>{feeRiskReasonText(r)}</Label>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  tag: { alignSelf: "flex-start", borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  text: { fontSize: fontSizes.caption, fontWeight: "600" },
});
