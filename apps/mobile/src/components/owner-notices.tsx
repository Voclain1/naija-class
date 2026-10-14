import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { SchoolMeDto } from "@school-kit/types";

import { staffSchoolPlan, staffSetupState } from "../lib/api/staff-admin";
import { staffWebHandoff } from "../lib/api/staff-auth";
import { queryKeys } from "../lib/query/keys";
import { setupProgress } from "../lib/staff/setup-progress";
import { planConsequenceSentence, planUsageSentence } from "../lib/staff/plan-copy";
import { REMIND_AFTER_SESSIONS } from "../lib/staff/logo-reminder";
import { dismissLogoReminder, noteSittingAndCheck } from "../lib/staff/logo-reminder-store";
import { signedInWebUrl, webUrl } from "../lib/web-handoff";
import { spacing } from "../theme/tokens";
import { Body, Button, Card, Heading, Notice } from "./ui";

// What the website tells an owner or admin about their school's setup, on the
// phone too (pre-build audit, owner's decision 2026-10-14):
//
//   SetupProgressCard — "School setup 75% done", and the next thing to do.
//   LogoReminderCard  — no logo yet; closable, back after a few sittings.
//   PlanNotice        — near or past the plan's student limit (Students).
//
// The fixes themselves are made on the website (logo upload, settings, the
// setup steps), so each card opens the website, signed in where possible.
// Every one is advice: a failed load renders nothing rather than an error.

function openOnWeb(path: string): void {
  void signedInWebUrl(path, (next) => staffWebHandoff(next)).then((url) => {
    if (url) void Linking.openURL(url);
  });
}

const webConfigured = (): boolean => webUrl("/") !== null;

export function SetupProgressCard({
  schoolId,
  userId,
  school,
}: {
  schoolId: string;
  userId: string;
  school: SchoolMeDto;
}) {
  const setup = useQuery({
    queryKey: queryKeys.staffSetupState(schoolId, userId),
    queryFn: staffSetupState,
    // A school still in the wizard finishes onboarding on the website first,
    // the web dashboard's rule (use-setup-state.ts).
    enabled: schoolId !== "" && userId !== "" && school.status === "ACTIVE",
    staleTime: 5 * 60_000,
  });
  if (!setup.data) return null;

  const { percent, next } = setupProgress(setup.data.steps, school);
  if (percent >= 100 || !next) return null;

  return (
    <Card style={styles.card}>
      <Heading>School setup · {percent}% done</Heading>
      <Body muted>Next: {next.label}</Body>
      {webConfigured() ? (
        <Button title="Continue on the website" variant="secondary" onPress={() => openOnWeb(next.href)} />
      ) : (
        <Body muted>Setup is done on the SchoolKit website.</Body>
      )}
    </Card>
  );
}

export function LogoReminderCard({ school }: { school: SchoolMeDto }) {
  const needsLogo = !school.logoUrl;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!needsLogo) {
      setVisible(false);
      return;
    }
    let live = true;
    void noteSittingAndCheck(school.id).then((show) => {
      if (live) setVisible(show);
    });
    return () => {
      live = false;
    };
  }, [needsLogo, school.id]);

  if (!visible) return null;

  function close(): void {
    setVisible(false);
    void dismissLogoReminder(school.id);
  }

  return (
    <Card style={styles.card}>
      <Heading>Add your school&apos;s logo</Heading>
      <Body muted>
        Parents and staff see your logo beside {school.name} in the app and the parent portal. Until you add one,
        SchoolKit&apos;s logo shows in its place. Closed, this comes back after {REMIND_AFTER_SESSIONS} visits.
      </Body>
      <View style={styles.actions}>
        {webConfigured() ? (
          <Button title="Add logo on the website" onPress={() => openOnWeb("/settings/school")} />
        ) : null}
        <Button title="Not now" variant="secondary" onPress={close} />
      </View>
    </Card>
  );
}

export function PlanNotice({ schoolId, userId }: { schoolId: string; userId: string }) {
  const plan = useQuery({
    queryKey: queryKeys.staffSchoolPlan(schoolId, userId),
    queryFn: staffSchoolPlan,
    enabled: schoolId !== "" && userId !== "",
    staleTime: 5 * 60_000,
  });
  const p = plan.data;
  if (!p || p.status === "ok") return null;
  const blocking = p.enforcement === "enforce" && p.status === "over";
  const consequence = planConsequenceSentence(p);

  return (
    <Notice tone={blocking ? "danger" : "warning"}>
      {p.status === "over" ? "Over your plan's student limit. " : "Close to your plan's student limit. "}
      {planUsageSentence(p)}
      {consequence ? ` ${consequence}` : ""}
    </Notice>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  actions: { gap: spacing.sm },
});
