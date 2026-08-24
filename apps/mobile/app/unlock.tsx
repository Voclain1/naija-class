import { Redirect } from "expo-router";
import { Body, Button, Heading, Screen } from "../src/components/ui";
import { useSession } from "../src/lib/auth/session";

export default function UnlockScreen() {
  const { status, unlock, signOut } = useSession();
  if (status === "authenticated") return <Redirect href="/staff" />;
  if (status !== "locked") return <Redirect href="/login" />;
  return (
    <Screen>
      <Heading>Staff access locked</Heading>
      <Body>Use your device PIN or biometrics to continue.</Body>
      <Button title="Unlock" onPress={() => void unlock()} />
      <Button title="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
