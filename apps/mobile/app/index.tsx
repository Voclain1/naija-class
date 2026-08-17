import { Redirect } from "expo-router";
import { useSession } from "../src/lib/auth/session";

// Route gate. Two things are decided here and nowhere else: whether there is a
// session at all, and which principal it belongs to.
//
// Deliberately a <Redirect> rather than an imperative router.replace() in an
// effect: expo-router resolves it during render, so there is no frame where a
// signed-out user is looking at a screen they should not see — and no frame
// where a student is looking at the parent's list of children.
//
// A student lands on /me, never on /students. That is not just a different
// home screen: /students/* is the guardian surface, keyed by a student id in
// the URL, and the student API deliberately has no id-taking route at all
// (phase-6.md §8). Sending a student there would ask the wrong server
// question with the wrong credential.
export default function Index() {
  const { status, principal } = useSession();

  if (status === "loading") return null;
  if (status !== "authenticated") return <Redirect href="/login" />;

  return principal === "student" ? (
    <Redirect href="/me" />
  ) : (
    <Redirect href="/students" />
  );
}
