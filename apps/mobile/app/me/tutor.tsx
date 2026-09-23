import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";

import { useSession } from "../../src/lib/auth/session";
import { spacing } from "../../src/theme/tokens";
import { Body, Card, Label, Notice, Screen } from "../../src/components/ui";
import { ScreenHeader } from "../../src/components/layout";

// The AI tutor's pathway, not the tutor (phone-for-every-role.md C2).
//
// Phase 7 holds the real thing, and it is blocked on a vendor decision for
// embeddings, because a tutor without the school's own curriculum behind it
// gives confident answers about the wrong syllabus. This screen exists so the
// route, the menu entry and the student's expectation are all in place — and
// so nobody is tempted to fill the gap with a generic chatbot in the
// meantime.

export default function TutorComingSoonScreen() {
  const { status, principal } = useSession();
  if (status === "locked") return <Redirect href="/unlock" />;
  if (status !== "authenticated" || principal !== "student") return <Redirect href="/login" />;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title="Ask about your work" subtitle="Not ready yet" />
        <Notice tone="info">This is being built. It isn&apos;t available yet.</Notice>
        <Card style={styles.card}>
          <Body>When it&apos;s ready, you&apos;ll be able to:</Body>
          <Label>· Ask about a topic you&apos;re stuck on, in your own words.</Label>
          <Label>· Get an explanation that follows YOUR school&apos;s scheme of work.</Label>
          <Label>· Practise a topic before a test.</Label>
        </Card>
        <Body muted>
          It is deliberately not switched on early: an answer that follows a different syllabus is
          worse than no answer, so it waits until your school&apos;s own curriculum is behind it.
        </Body>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  card: { gap: spacing.xs },
});
