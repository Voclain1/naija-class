import { ScrollView, StyleSheet } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatKobo } from "@school-kit/types";

import {
  getMyTimetable,
  getStudentMe,
  listStudentAttendance,
  listStudentFees,
  listStudentResults,
} from "../../src/lib/api/student-portal";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { AppMenu, MenuButton, useAppMenu } from "../../src/components/app-menu";
import { studentDestinations } from "../../src/lib/navigation/destinations";
import { serverToday } from "../../src/lib/staff/server-date";
import { studentHomework } from "../../src/lib/api/student-portal";
import { CallSchool } from "../../src/components/call-school";
import { isoWeekdayOf, greeting, nowMinutesOfDay } from "../../src/lib/when";
import {
  describeLesson,
  formatHundredths,
  latestAttendance,
  latestResult,
  nextLesson,
} from "../../src/lib/family/today";
import { totalOwed } from "../../src/lib/family/fees";
import { spacing } from "../../src/theme/tokens";
import { Card, CenteredMessage, Label, Notice, Screen } from "../../src/components/ui";
import { ListRow, ScreenHeader, SectionHeader, Skeleton, StatRow } from "../../src/components/layout";
import { FreshnessLabel } from "../../src/components/freshness-label";

// A student's home, redesigned (D6): "what do I have today" first — the next
// lesson, how their attendance stands, their newest result and anything owed
// — then the screens themselves.
//
// Every figure here is the server's: percentages arrive as integer hundredths
// and are only formatted, money through formatKobo. The home computes nothing.

export default function MyHomeScreen() {
  const { status, principal, student: sessionStudent, signOut } = useSession();
  const menu = useAppMenu();
  const router = useRouter();
  const enabled = status === "authenticated" && principal === "student";

  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: getStudentMe, enabled });
  const timetable = useQuery({
    queryKey: queryKeys.myTimetable,
    queryFn: getMyTimetable,
    enabled,
    staleTime: 60 * 60_000,
  });
  const attendance = useQuery({
    queryKey: queryKeys.myAttendance,
    queryFn: listStudentAttendance,
    enabled,
    staleTime: 30 * 60_000,
  });
  const results = useQuery({
    queryKey: queryKeys.myResults,
    queryFn: listStudentResults,
    enabled,
    staleTime: 30 * 60_000,
  });
  // Homework has the shortest staleTime on this screen, and deliberately so:
  // every other figure here keeps for the day, and "due tomorrow" does not.
  const homework = useQuery({
    queryKey: queryKeys.myHomework,
    queryFn: studentHomework,
    enabled,
    staleTime: 60_000,
  });
  const fees = useQuery({
    queryKey: queryKeys.myFees,
    queryFn: listStudentFees,
    enabled,
    staleTime: 30 * 60_000,
  });

  // B9 again, on the student's side: nothing is pushed when homework is set,
  // so this line on the screen they already open is the whole notification.
  // Overdue outranks due-soon, and silence when there is neither.
  const homeworkItems = homework.data?.data ?? [];
  const overdueCount = homeworkItems.filter((item) => item.overdue).length;
  const dueSoonCount = homework.data?.dueSoonCount ?? 0;
  const homeworkLine =
    overdueCount > 0
      ? {
          value: `${overdueCount} overdue`,
          label: overdueCount === 1 ? "1 piece of homework is late" : "Homework past its due date",
          overdue: true,
        }
      : dueSoonCount > 0
        ? { value: `${dueSoonCount} due soon`, label: "Homework due today or tomorrow", overdue: false }
        : null;

  if (status === "locked") return <Redirect href="/unlock" />;
  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") return <Redirect href="/students" />;

  // Prefer the freshly fetched profile, fall back to what sign-in put in
  // memory. Either can be absent on a cold, offline start.
  const student = meQuery.data?.student ?? sessionStudent;
  const school = meQuery.data?.school ?? null;
  const enrollment = student?.currentEnrollment ?? null;

  const today = serverToday();
  const lesson = nextLesson(timetable.data, isoWeekdayOf(today), nowMinutesOfDay());
  const term = latestAttendance(attendance.data?.data ?? []);
  const newest = latestResult(results.data?.data ?? []);
  const owed = totalOwed(fees.data?.data ?? []);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          title={`${greeting(new Date().getHours())}${student ? `, ${student.firstName}` : ""}`}
          subtitle={[school?.name, enrollment ? enrollment.classArm.name : null].filter(Boolean).join(" · ")}
          action={<MenuButton onPress={menu.open} />}
        />
        <FreshnessLabel updatedAt={meQuery.dataUpdatedAt} />

        {meQuery.isPending && !student ? <Skeleton lines={4} /> : null}
        {meQuery.isError && !student ? (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load your details just now.</Notice>
          </CenteredMessage>
        ) : null}

        {student ? (
          <>
            <SectionHeader title="Today" />
            <Card style={styles.band}>
              {lesson ? (
                <StatRow
                  icon="time-outline"
                  value={describeLesson(lesson)}
                  label="Next lesson"
                  onPress={() => router.push("/me/timetable")}
                />
              ) : (
                <StatRow
                  icon="cafe-outline"
                  value="No more lessons today"
                  label={timetable.data?.className ?? "Your timetable"}
                  onPress={() => router.push("/me/timetable")}
                />
              )}
              {homeworkLine ? (
                <StatRow
                  icon="book-outline"
                  value={homeworkLine.value}
                  label={homeworkLine.label}
                  onPress={() => router.push("/me/homework")}
                  {...(homeworkLine.overdue ? { tone: "warning" as const } : {})}
                />
              ) : null}
              {term ? (
                <StatRow
                  icon="checkbox-outline"
                  value={formatHundredths(term.attendanceRate) ?? "—"}
                  label={`Attendance · ${term.termName}`}
                  onPress={() => router.push("/me/attendance")}
                />
              ) : null}
              {newest ? (
                <StatRow
                  icon="ribbon-outline"
                  value={formatHundredths(newest.overallAverage) ?? newest.termName}
                  label={`${newest.termName} results are ready`}
                  onPress={() => router.push("/me/results")}
                />
              ) : null}
              {owed > 0 ? (
                <StatRow
                  icon="wallet-outline"
                  tone="warning"
                  value={formatKobo(owed)}
                  label="School fees outstanding"
                  onPress={() => router.push("/me/fees")}
                />
              ) : null}
            </Card>
          </>
        ) : null}

        <SectionHeader title="Your school work" />
        <ListRow icon="ribbon-outline" title="My results" subtitle="Report cards the school has released" onPress={() => router.push("/me/results")} />
        <ListRow icon="checkbox-outline" title="My attendance" subtitle="How many days you were present" onPress={() => router.push("/me/attendance")} />
        <ListRow icon="calendar-outline" title="My timetable" subtitle="Your class's published timetable" onPress={() => router.push("/me/timetable")} />
        <ListRow icon="wallet-outline" title="My fees" subtitle="What has been billed and paid" onPress={() => router.push("/me/fees")} />
        <ListRow icon="today-outline" title="School calendar" subtitle="Holidays, exams and events" onPress={() => router.push("/me/calendar")} />

        {/* The AI tutor is Phase 7 and honestly labelled: it needs curriculum
            grounding to be worth anything, and that is a vendor decision, not
            a screen. A shallow chatbot here would teach a student the feature
            is useless. */}
        <SectionHeader title="Coming soon" />
        <ListRow icon="sparkles-outline" title="Ask about your work" subtitle="Help with a topic you're stuck on — not ready yet" onPress={() => router.push("/me/tutor")} />

        {student ? (
          <>
            <SectionHeader title="Signing in again" />
            <Card style={styles.band}>
              {/* The two things a child needs to sign in on a new phone,
                  shown while they are still signed in — nobody else in their
                  life is likely to know the school code. */}
              <StatRow icon="id-card-outline" value={student.admissionNumber} label="Admission number" />
              {school ? <StatRow icon="school-outline" value={school.slug} label="School code" /> : null}
            </Card>
            <Label>Keep these somewhere safe.</Label>
          </>
        ) : null}
        {/* D12. A student with a problem should not have to find the number
            either — and the only contact this app offers anyone is the school
            itself, never a member of staff directly (D11). */}
        {school?.phone ? <CallSchool phone={school.phone} /> : null}
      </ScrollView>

      <AppMenu
        visible={menu.visible}
        onClose={menu.close}
        destinations={studentDestinations()}
        person={{
          name: student ? `${student.firstName} ${student.lastName}` : "Student",
          detail: ["Student", school?.name].filter(Boolean).join(" · "),
        }}
        onSignOut={() => void signOut()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  band: { gap: spacing.xs },
});
