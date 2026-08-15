import { Redirect } from "expo-router";
import { useSession } from "../src/lib/auth/session";

// Route gate. The whole app is behind a guardian session, so the entry point
// only decides which side of that line the user is on.
//
// Deliberately a <Redirect> rather than an imperative router.replace() in an
// effect: expo-router resolves it during render, so there is no frame where a
// signed-out user is looking at a screen they should not see.
export default function Index() {
  const { status } = useSession();

  if (status === "loading") return null;

  return status === "authenticated" ? (
    <Redirect href="/students" />
  ) : (
    <Redirect href="/login" />
  );
}
