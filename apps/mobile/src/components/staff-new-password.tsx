import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { meetsPasswordPolicy } from "@school-kit/types";

import { TextField } from "./form";
import { Body, Button, Heading, Notice } from "./ui";
import { ApiError, ApiNetworkError } from "../lib/api/client";
import { staffChooseNewPassword } from "../lib/api/staff-auth";
import { spacing } from "../theme/tokens";

/**
 * Sign-in found the right password, but one set under the older rules. The
 * person chooses one under today's rules here, then signs in with it.
 */
export function StaffNewPassword({ token, onDone, onCancel }: { token: string; onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strong = meetsPasswordPolicy(password);
  const matches = password === again;

  async function save() {
    if (!strong) return setError("Use at least 8 characters with a capital letter, a small letter, a number and a symbol.");
    if (!matches) return setError("The two passwords are not the same.");
    setError(null);
    setBusy(true);
    try {
      await staffChooseNewPassword(token, password);
      onDone();
    } catch (caught) {
      if (caught instanceof ApiNetworkError) setError("Can't reach SchoolKit. Check your connection and try again.");
      else if (caught instanceof ApiError && caught.status === 400) setError(caught.message);
      else setError("That did not work. Sign in again to get a fresh chance to change it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Heading>Choose a new password</Heading>
      <Body muted>
        Your password was set before SchoolKit asked for stronger ones. Choose a new one to carry on. It needs at least 8
        characters, with a capital letter, a small letter, a number and a symbol.
      </Body>
      <TextField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
      <TextField label="Type it again" value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button title={busy ? "Saving…" : "Save new password"} onPress={() => void save()} disabled={busy || !password || !again} />
      <Button variant="secondary" title="Back to sign in" onPress={onCancel} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
});
