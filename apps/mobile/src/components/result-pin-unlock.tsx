import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ReleasedResultDetailDto } from "@school-kit/types";

import { ApiError, ApiNetworkError } from "../lib/api/client";
import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { TextField } from "./form";
import { Body, Button } from "./ui";

// The PIN box on a locked term (Phase 8c / CP6b, D54), shared by the guardian
// and student result screens. One redemption unlocks this child's term
// everywhere and takes one use of the card, once (D57).
//
// A tinted surface, never an accent border (CLAUDE.md), and the state said in
// words, not colour alone.

export { isResultLocked } from "../lib/results/result-lock";

export function ResultPinUnlock({
  unlock,
  onUnlocked,
}: {
  unlock: (pin: string) => Promise<ReleasedResultDetailDto>;
  onUnlocked: (result: ReleasedResultDetailDto) => void;
}) {
  const { colors } = useTheme();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!pin.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      onUnlocked(await unlock(pin));
    } catch (error) {
      if (error instanceof ApiNetworkError) {
        setMessage("Your phone couldn't reach the school. Nothing was used — try again when you have signal.");
      } else if (error instanceof ApiError) {
        setMessage(error.message || "That PIN didn't work.");
      } else {
        setMessage("That PIN didn't work.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.box, { backgroundColor: `${colors.warning}26` }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>These results need a result PIN</Text>
      <Body>
        Your school released this term&apos;s results with result PIN cards. Enter the 12-digit PIN from the card. Once
        it works, the results stay open here.
      </Body>
      <TextField
        label="Result PIN"
        value={pin}
        onChangeText={setPin}
        keyboardType="number-pad"
        placeholder="1234 5678 9012"
        maxLength={20}
        error={message}
      />
      <Button title="Open results" onPress={() => void submit()} loading={busy} disabled={!pin.trim() || busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
  title: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.bodyLarge },
});
