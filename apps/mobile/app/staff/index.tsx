import { useMemo } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatMinuteOfDay } from "@school-kit/types";

import { staffTeacherScope } from "../../src/lib/api/staff-attendance";
import { staffMyTimetable } from "../../src/lib/api/staff-schedule";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { hasPermission } from "../../src/lib/auth/permissions";
import { serverToday } from "../../src/lib/staff/server-date";
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

// CP8 — the staff dashboard.
//
// What this replaces: a vertical list of cards, each with a text button, grown
// one card per checkpoint. It worked and it read as a prototype.
//
// Three bands, in the order a teacher's attention goes:
//   1. Who and when — the greeting, the school, the date.
//   2. TODAY — the next lesson, and whether the register is marked. Both come
//      from data the app already fetches; CP8 adds no endpoint.
//   3. Everywhere else — an icon grid, offered on PERMISSION and on what the
//      server says this person teaches, never on a role name.
//
// D30: the today band renders nothing at all when there is nothing true to
// say. No timetable published, no current term, no form class — then no strip,
// rather than a row of dashes pretending to be data.

const DAY_MS = 86_400_000;

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** ISO weekday (1 = Monday … 7 = Sunday) for a yyyy-mm-dd date, in UTC. */
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

export default function StaffDashboardScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "";

  const scope = useQuery({
    queryKey: queryKeys.staffScope(schoolId, userId),
    queryFn: staffTeacherScope,
    enabled: ready,
    staleTime: 60_000,
  });

  const timetable = useQuery({
    queryKey: queryKeys.staffTimetable(schoolId, userId),
    queryFn: () => staffMyTimetable(),
    enabled: ready,
    staleTime: 5 * 60_000,
  });

  const today = serverToday();
  const weekday = isoWeekdayOf(today);

  // The next lesson still to come today, by the server's clock. Deliberately
  // "still to come": a teacher at 2pm wants their next period, not the 8am one.
  const nextLesson = useMemo(() => {
    if (weekday === null) return null;
    const nowMinutes = (() => {
      const ms = Date.now() % DAY_MS;
      return Math.floor(ms / 60_000);
    })();
    return (
      (timetable.data?.ownLessons ?? [])
        .filter((lesson) => lesson.dayOfWeek === weekday && lesson.slot.endMinute >= nowMinutes)
        .sort((a, b) => a.slot.startMinute - b.slot.startMinute)[0] ?? null
    );
  }, [timetable.data, weekday]);

  const data = scope.data;
  const canEnterMarks = hasPermission(staff?.permissions ?? [], "assessment-score.create");
  const canWriteLessonNotes = hasPermission(staff?.permissions ?? [], "lesson-plan.create");
  const canSeeCollections = hasPermission(staff?.permissions ?? [], "finance.dashboard.read");
  const teachesSubjects = Object.values(data?.subjectsByArm ?? {}).some((s) => s.length > 0);
  const formArms = (data?.classArms ?? []).filter((arm) =>
    (data?.formTeacherArmIds ?? []).includes(arm.id),
  );

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const tiles: Array<{ icon: IconName; label: string; hint?: string; href: string; show: boolean }> = [
    {
      icon: "create-outline",
      label: "Enter marks",
      hint: "Tests and exams",
      href: "/staff/gradebook",
      show: canEnterMarks && teachesSubjects,
    },
    {
      icon: "checkbox-outline",
      label: "Attendance",
      hint: formArms[0]?.name,
      href: formArms[0] ? `/staff/attendance/${formArms[0].id}` : "/staff/classes",
      show: formArms.length > 0,
    },
    {
      icon: "document-text-outline",
      label: "Lesson notes",
      hint: "Write with AI",
      href: "/staff/lesson-notes",
      show: canWriteLessonNotes,
    },
    {
      icon: "library-outline",
      label: "Curriculum",
      hint: "Scheme of work",
      href: "/staff/curriculum",
      show: canWriteLessonNotes,
    },
    {
      icon: "chatbox-ellipses-outline",
      label: "Report comments",
      hint: formArms[0]?.name,
      href: formArms[0] ? `/staff/report-cards/${formArms[0].id}` : "/staff/classes",
      show: formArms.length > 0,
    },
    { icon: "people-outline", label: "My classes", href: "/staff/classes", show: true },
    { icon: "calendar-outline", label: "Timetable", href: "/staff/timetable", show: true },
    { icon: "today-outline", label: "School calendar", href: "/staff/calendar", show: true },
    {
      icon: "cash-outline",
      label: "Collections",
      hint: "Fees owed",
      href: "/staff/collections",
      show: canSeeCollections,
    },
    { icon: "person-outline", label: "My profile", href: "/staff/profile", show: true },
  ];

  const visible = tiles.filter((tile) => tile.show);
  const todayLabel = formatToday(today);
  const hasToday = nextLesson !== null || formArms.length > 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title={`${greeting(new Date().getHours())}${staff ? `, ${staff.user.firstName}` : ""}`}
          subtitle={[staff?.school.name, todayLabel].filter(Boolean).join(" · ")}
        />

        {scope.isError && !data ? (
          <Notice tone="danger">
            We couldn&apos;t load your classes. Pull down or try again shortly.
          </Notice>
        ) : null}

        {/* Today — rendered only when there is something true to say (D30). */}
        {hasToday ? (
          <Card style={styles.todayCard}>
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
        ) : null}

        {scope.isPending ? <Skeleton lines={4} /> : null}

        {data && visible.length === 0 ? (
          <EmptyState
            icon="school-outline"
            title="Nothing assigned yet"
            body="Your school hasn't given you classes or subjects. Ask your administrator to set that up."
          />
        ) : null}

        {visible.length > 0 ? (
          <>
            <SectionHeader title="Everything you do" />
            <TileGrid>
              {visible.map((tile) => (
                <ActionTile
                  key={tile.label}
                  icon={tile.icon}
                  label={tile.label}
                  hint={tile.hint ?? null}
                  onPress={() => router.push(tile.href)}
                />
              ))}
            </TileGrid>
          </>
        ) : null}

        <Body muted>
          {staff ? `Signed in as ${staff.user.firstName} ${staff.user.lastName}.` : ""}
        </Body>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  todayCard: { gap: spacing.xs },
});
