import { Redirect } from "expo-router";
import { Body, Heading, Screen } from "../../src/components/ui";
import { useSession } from "../../src/lib/auth/session";

export default function StaffFoundationScreen() {
  const { status, principal, staff } = useSession();
  if (status === "locked") return <Redirect href="/unlock" />;
  if (status !== "authenticated" || principal !== "staff") return <Redirect href="/login" />;
  return (
    <Screen>
      <Heading>Staff mobile</Heading>
      <Body>{staff ? `${staff.user.firstName}, your secure staff session is ready.` : "Restoring staff access…"}</Body>
      <Body muted>Attendance, collections, and the operational dashboard remain gated until their checkpoints pass.</Body>
    </Screen>
  );
}
