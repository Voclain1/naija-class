import { useMemo } from "react";
import { Linking, ScrollView, StyleSheet } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatKobo, formatMinuteOfDay, type DashboardAlertType } from "@school-kit/types";

import { staffTeacherScope } from "../../src/lib/api/staff-attendance";
import { staffMyTimetable } from "../../src/lib/api/staff-schedule";
import { staffAdminDashboard } from "../../src/lib/api/staff-admin";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { hasPermission } from "../../src/lib/auth/permissions";
import { isTeacher } from "../../src/lib/auth/roles";
import { serverToday } from "../../src/lib/staff/server-date";
import { useTermContext } from "../../src/lib/staff/use-term-context";
import { WEB_NOT_CONFIGURED_MESSAGE, webUrl } from "../../src/lib/web-handoff";
import { spacing } from "../../src/theme/tokens";
import { Body, Card, Notice, Screen } from "../../src/components/ui";
import {
  ActionTile,
  EmptyState,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  StatRow,
  TileGrid,
  type IconName,
} from "../../src/components/layout";

// The staff dashboard — one screen, shaped by WHO is signed in.
//
// CP8 built it for teachers only, and CP4 found the cost: every staff user was
// sent to `/teacher-scope/me`, which the server refuses without the teacher
// role, so a pure owner or admin saw "We couldn't load your classes" on the
// very first screen. Now each band renders only for the people it works for:
//
//   TEACHER band — next lesson, today's register, and the teaching tiles.
//     Gated on the teacher ROLE, because that is the server's own gate on
//     /teacher-scope/* (D32). Nothing in it is fetched for anyone else.
//   SCHOOL band — enrolment, fees, attendance today, and what needs the
//     head's attention. Gated on `dashboard.read`, the endpoint's permission.
//
// Someone holding both (an owner who also teaches) sees both. Everything below
// the bands is still offered on permission, never on a role name.
//
// D30 still holds for every band: say nothing rather than print a placeholder
// pretending to be data.

const DAY_MS = 86_400_000;

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function isoWeekdayOf(date: string | null): number | null {
  if (date === null) return null;
  const parsed = Date.parse(date + "T00:00:00.000Z");
  if (Number.isNaN(parsed)) return null;
  const day = new Date(parsed).getUTCDay();
  return day === 0 ? 7 : day;
}

function formatToday(date: string | null): string | null {
  if (date === null) return null;
  const parsed = Date.parse(date + "T00:00:00.000Z");
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** What each dashboard alert means to a head, in their words. */
const ALERT_COPY: Record<DashboardAlertType, (count: number) => { label: string; icon: IconName }> = {
  overdue_fees: (n) => ({
    label: `${n} famil${n === 1 ? "y owes" : "ies owe"} overdue fees`,
    icon: "alert-circle-outline",
  }),
  pending_report_card_approval: (n) => ({
    label: `${n} report card${n === 1 ? "" : "s"} waiting for your approval`,
    icon: "document-text-outline",
  }),
  pending_staff_invitations: (n) => ({
    label: `${n} staff invitation${n === 1 ? "" : "s"} not yet accepted`,
    icon: "mail-unread-outline",
  }),
  term_health: (n) => ({
    label: `${n} thing${n === 1 ? "" : "s"} to fix in this term's setup`,
    icon: "construct-outline",
  }),
};

export default function StaffDashboardScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "";
  const permissions = staff?.permissions ?? [];

  const teacher = isTeacher(staff?.roles);
  const canSeeSchool = hasPermission(permissions, "dashboard.read");

  // --- teacher band: fetched ONLY for teachers (D32) -----------------------
  const scope = useQuery({
    queryKey: queryKeys.staffScope(schoolId, userId),
    queryFn: staffTeacherScope,
    enabled: ready && teacher,
    staleTime: 60_000,
  });
  const timetable = useQuery({
    queryKey: queryKeys.staffTimetable(schoolId, userId),
    queryFn: () => staffMyTimetable(),
    enabled: ready && teacher,
    staleTime: 5 * 60_000,
  });

  // --- school band: fetched ONLY for dashboard.read ------------------------
  const termContext = useTermContext({ schoolId, userId, enabled: ready && canSeeSchool });
  const termId = termContext.data?.term?.termId ?? "";
  const overview = useQuery({
    queryKey: queryKeys.staffAdminDashboard(schoolId, userId, termId),
    queryFn: () => staffAdminDashboard(termId),
    enabled: ready && canSeeSchool && termId !== "",
    staleTime: 60_000,
  });

  const today = serverToday();
  const weekday = isoWeekdayOf(today);

  const nextLesson = useMemo(() => {
    if (weekday === null) return null;
    const nowMinutes = Math.floor((Date.now() % DAY_MS) / 60_000);
    return (
      (timetable.data?.ownLessons ?? [])
        .filter((lesson) => lesson.dayOfWeek === weekday && lesson.slot.endMinute >= nowMinutes)
        .sort((a, b) => a.slot.startMinute - b.slot.startMinute)[0] ?? null
    );
  }, [timetable.data, weekday]);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const data = scope.data;
  const canEnterMarks = teacher && hasPermission(permissions, "assessment-score.create");
  const canWriteLessonNotes = teacher && hasPermission(permissions, "lesson-plan.create");
  const canSeeCollections = hasPermission(permissions, "finance.dashboard.read");
  const teachesSubjects = Object.values(data?.subjectsByArm ?? {}).some((s) => s.length > 0);
  const formArms = (data?.classArms ?? []).filter((arm) =>
    (data?.formTeacherArmIds ?? []).includes(arm.id),
  );

  function openOnWeb(path: string): void {
    const url = webUrl(path);
    if (url === null) return;
    void Linking.openURL(url);
  }
  const webConfigured = webUrl("/") !== null;

  const tiles: Array<{ icon: IconName; label: string; hint?: string; onPress: () => void; show: boolean }> = [
    {
      icon: "create-outline",
      label: "Enter marks",
      hint: "Tests and exams",
      onPress: () => router.push("/staff/gradebook"),
      show: canEnterMarks && teachesSubjects,
    },
    {
      icon: "checkbox-outline",
      label: "Attendance",
      hint: formArms[0]?.name,
      onPress: () =>
        router.push(formArms[0] ? `/staff/attendance/${formArms[0].id}` : "/staff/classes"),
      show: teacher && formArms.length > 0,
    },
    {
      icon: "document-text-outline",
      label: "Lesson notes",
      hint: "Write with AI",
      onPress: () => router.push("/staff/lesson-notes"),
      show: canWriteLessonNotes,
    },
    {
      icon: "library-outline",
      label: "Curriculum",
      hint: "Scheme of work",
      onPress: () => router.push("/staff/curriculum"),
      show: canWriteLessonNotes,
    },
    {
      icon: "chatbox-ellipses-outline",
      label: "Report comments",
      hint: formArms[0]?.name,
      onPress: () =>
        router.push(formArms[0] ? `/staff/report-cards/${formArms[0].id}` : "/staff/classes"),
      show: teacher && formArms.length > 0,
    },
    {
      icon: "people-outline",
      label: "My classes",
      onPress: () => router.push("/staff/classes"),
      show: teacher,
    },
    {
      icon: "calendar-outline",
      label: "Timetable",
      onPress: () => router.push("/staff/timetable"),
      show: teacher,
    },
    {
      icon: "cash-outline",
      label: "Collections",
      hint: "Fees owed",
      onPress: () => router.push("/staff/collections"),
      show: canSeeCollections,
    },
    {
      icon: "today-outline",
      label: "School calendar",
      onPress: () => router.push("/staff/calendar"),
      show: hasPermission(permissions, "calendar-event.read"),
    },
    {
      icon: "person-outline",
      label: "My profile",
      onPress: () => router.push("/staff/profile"),
      show: teacher,
    },
    {
      icon: "globe-outline",
      label: "Open the website",
      hint: "Settings, staff, payroll",
      onPress: () => openOnWeb("/dashboard"),
      // Offered to whoever has jobs that live only on the website.
      show: canSeeSchool,
    },
  ];

  const visible = tiles.filter((tile) => tile.show);
  const hasToday = teacher && (nextLesson !== null || formArms.length > 0);
  const school = overview.data;
  const alerts = (school?.needsYouToday ?? []).filter((alert) => alert.count > 0);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title={`${greeting(new Date().getHours())}${staff ? `, ${staff.user.firstName}` : ""}`}
          subtitle={[staff?.school.name, formatToday(today)].filter(Boolean).join(" · ")}
        />

        {/* ---- SCHOOL band (dashboard.read) ---- */}
        {canSeeSchool && termContext.data?.failure ? (
          <Notice tone="warning">
            There is no current term, so the school figures can&apos;t be shown. Set the current
            term on the website.
          </Notice>
        ) : null}

        {canSeeSchool && (overview.isPending && termId !== "") ? <Skeleton lines={4} /> : null}

        {school ? (
          <>
            <SectionHeader title="Your school" note={school.termName} />
            <Card style={styles.band}>
              <StatRow
                icon="people-outline"
                value={`${school.enrolled.count} students`}
                label={
                  school.enrolled.previousTermCount === null
                    ? "Enrolled this term"
                    : `Enrolled · ${school.enrolled.previousTermCount} last term`
                }
              />
              <StatRow
                icon="wallet-outline"
                value={`${school.fees.percent}% of fees collected`}
                label={`${formatKobo(school.fees.collected)} of ${formatKobo(school.fees.billed)}`}
                onPress={canSeeCollections ? () => router.push("/staff/collections") : undefined}
              />
              {school.attendanceToday.totalMarked > 0 ? (
                <StatRow
                  icon="checkmark-done-outline"
                  value={`${school.attendanceToday.percentPresent}% present today`}
                  label={`${school.attendanceToday.presentCount} present, ${school.attendanceToday.absentCount} absent`}
                />
              ) : null}
              {school.outstanding.debtorCount > 0 ? (
                <StatRow
                  icon="alert-circle-outline"
                  tone="warning"
                  value={`${formatKobo(school.outstanding.amount)} outstanding`}
                  label={`${school.outstanding.debtorCount} famil${
                    school.outstanding.debtorCount === 1 ? "y" : "ies"
                  } owing`}
                  onPress={canSeeCollections ? () => router.push("/staff/collections/debtors") : undefined}
                />
              ) : null}
            </Card>

            {alerts.length > 0 ? (
              <>
                <SectionHeader title="Needs you" />
                <Card style={styles.band}>
                  {alerts.map((alert) => {
                    const copy = ALERT_COPY[alert.type](alert.count);
                    return (
                      <StatRow
                        key={alert.type}
                        icon={copy.icon}
                        tone="warning"
                        value={copy.label}
                        label={webConfigured ? "Open on the website" : "Handled on the website"}
                        onPress={webConfigured ? () => openOnWeb(alert.href) : undefined}
                      />
                    );
                  })}
                </Card>
              </>
            ) : null}
          </>
        ) : null}

        {/* ---- TEACHER band (teacher role, D32) ---- */}
        {teacher && scope.isError && !data ? (
          <Notice tone="danger">
            We couldn&apos;t load your classes. Try again shortly.
          </Notice>
        ) : null}

        {hasToday ? (
          <>
            <SectionHeader title="Your day" />
            <Card style={styles.band}>
              {nextLesson ? (
                <StatRow
                  icon="time-outline"
                  value={`${nextLesson.subjectName} · ${formatMinuteOfDay(nextLesson.slot.startMinute)}`}
                  label={`Next lesson · ${nextLesson.className}`}
                  onPress={() => router.push("/staff/timetable")}
                />
              ) : null}
              {formArms.map((arm) => (
                <StatRow
                  key={arm.id}
                  icon="clipboard-outline"
                  value={arm.name}
                  label="Take today's register"
                  tone="warning"
                  onPress={() => router.push(`/staff/attendance/${arm.id}`)}
                />
              ))}
            </Card>
          </>
        ) : null}

        {teacher && scope.isPending ? <Skeleton lines={3} /> : null}

        {visible.length === 0 ? (
          <EmptyState
            icon="school-outline"
            title="Nothing assigned yet"
            body="Your account doesn't have any jobs set up on the phone. Ask your school administrator."
          />
        ) : (
          <>
            <SectionHeader title="Everything you do" />
            <TileGrid>
              {visible.map((tile) => (
                <ActionTile
                  key={tile.label}
                  icon={tile.icon}
                  label={tile.label}
                  hint={tile.hint ?? null}
                  onPress={tile.onPress}
                />
              ))}
            </TileGrid>
          </>
        )}

        {canSeeSchool && !webConfigured ? (
          <Body muted>{WEB_NOT_CONFIGURED_MESSAGE}</Body>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  band: { gap: spacing.xs },
});
