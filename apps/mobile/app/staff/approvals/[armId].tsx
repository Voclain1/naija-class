import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  staffApproveArm,
  staffCompleteness,
  staffReleaseArm,
  staffReopenArm,
  staffReportCardBoard,
} from "../../../src/lib/api/staff-approvals";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { armStage, cardTotal, describeStage } from "../../../src/lib/staff/approval-stage";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import { Button, Card, CenteredMessage, Label, Notice, Screen } from "../../../src/components/ui";
import { ListRow, ScreenHeader, SectionHeader, Skeleton, StatRow } from "../../../src/components/layout";

// CP4b — one class's report cards, and the three things a head can do.
//
// D33: every action is confirmed, and RELEASE says who will see it. Release is
// the moment parents and students can read a child's results, and it freezes
// the cards. Approve is internal, so its confirmation is lighter. Reopen needs
// a reason because the server requires one and the audit trail is its point.
//
// The buttons offered are exactly the transitions the server will accept for
// this class's current state (approval-stage.ts mirrors assertAllInState). If
// the two ever disagree, the server's refusal is shown in its own words.

function describeFailure(error: unknown): string {
  if (error instanceof ApiNetworkError) {
    return "Your phone couldn't reach the server. Nothing changed — try again when you have signal.";
  }
  if (error instanceof ApiError) {
    if (error.code === "ARM_RENDER_IN_FLIGHT") {
      return "These report cards are still being prepared as PDFs. Try again in a minute.";
    }
    return error.message || "That couldn't be done.";
  }
  return "That couldn't be done.";
}

export default function ApprovalArmScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { armId } = useLocalSearchParams<{ armId: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const permissions = staff?.permissions ?? [];
  const ready = authed && schoolId !== "" && userId !== "" && !!armId;

  const canApprove = hasPermission(permissions, "report-card.principal-approve");
  const canRelease = hasPermission(permissions, "report-card.release");
  const canReopen = hasPermission(permissions, "report-card.reopen");

  // The overview is almost always already cached from the list screen.
  const report = useQuery({
    queryKey: queryKeys.staffCompleteness(schoolId, userId, null),
    queryFn: () => staffCompleteness(),
    enabled: ready,
    staleTime: 30_000,
  });
  const termId = report.data?.term?.id ?? "";
  const pipeline = report.data?.reportCards?.rows.find((row) => row.groupId === armId) ?? null;

  const board = useQuery({
    queryKey: queryKeys.staffReportCardBoard(schoolId, userId, termId, armId ?? ""),
    queryFn: () => staffReportCardBoard(termId, armId as string),
    enabled: ready && termId !== "",
    staleTime: 15_000,
  });

  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.staffCompleteness(schoolId, userId, null) }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.staffReportCardBoard(schoolId, userId, termId, armId ?? ""),
      }),
    ]);
  }

  const transition = useMutation({
    mutationFn: async (action: "approve" | "release" | "reopen") => {
      const input = { termId, classArmId: armId as string };
      if (action === "approve") return staffApproveArm(input);
      if (action === "release") return staffReleaseArm(input);
      return staffReopenArm({ ...input, reason: reason.trim() });
    },
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: async (result, action) => {
      setReopening(false);
      setReason("");
      setNotice(
        action === "approve"
          ? `Approved ${result.cardCount} report card${result.cardCount === 1 ? "" : "s"}.`
          : action === "release"
            ? `Released ${result.cardCount} report card${result.cardCount === 1 ? "" : "s"}. Families can see them now.`
            : `Reopened ${result.cardCount} report card${result.cardCount === 1 ? "" : "s"} for correction.`,
      );
      await refresh();
    },
    onError: (error: unknown) => setFailure(describeFailure(error)),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (report.isPending || (termId !== "" && board.isPending)) {
    return (
      <Screen>
        {header}
        <Skeleton lines={5} />
      </Screen>
    );
  }

  if ((report.isError && !report.data) || (board.isError && !board.data)) {
    return (
      <Screen>
        {header}
        <CenteredMessage>
          <Notice tone="danger">We couldn&apos;t load this class. Try again shortly.</Notice>
          <Button
            title="Try again"
            variant="secondary"
            onPress={() => {
              void report.refetch();
              void board.refetch();
            }}
          />
        </CenteredMessage>
      </Screen>
    );
  }

  if (!pipeline) {
    return (
      <Screen>
        {header}
        <Notice tone="info">This class isn&apos;t in this term&apos;s report cards.</Notice>
      </Screen>
    );
  }

  const stage = armStage(pipeline.byStatus);
  const total = cardTotal(pipeline.byStatus);
  const rows = board.data?.data ?? [];
  const busy = transition.isPending;

  function confirmApprove(): void {
    Alert.alert(
      "Approve these report cards?",
      `${total} card${total === 1 ? "" : "s"} for ${pipeline!.label}. They stay hidden from families until you release them.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Approve", onPress: () => transition.mutate("approve") },
      ],
    );
  }

  function confirmRelease(): void {
    // D33: release is the one that reaches families, and freezes the cards.
    Alert.alert(
      "Release to families?",
      `Parents and students in ${pipeline!.label} will be able to read ${total} report card${
        total === 1 ? "" : "s"
      } as soon as you do this. The cards are then locked; changing one means reopening the whole class.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Release", style: "destructive", onPress: () => transition.mutate("release") },
      ],
    );
  }

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader title={pipeline.label} subtitle={describeStage(stage, pipeline.byStatus)} />

          <Card style={styles.band}>
            <StatRow icon="people-outline" value={`${pipeline.enrolledCount} enrolled`} label="In this class this term" />
            <StatRow icon="document-text-outline" value={`${total} report cards`} label="Built for this term" />
            {pipeline.studentsWithoutCard > 0 ? (
              <StatRow
                icon="alert-circle-outline"
                tone="warning"
                value={`${pipeline.studentsWithoutCard} without a card`}
                label="Enrolled but not included — rebuild on the website to add them"
              />
            ) : null}
          </Card>

          {notice ? <Notice tone="info">{notice}</Notice> : null}
          {failure ? <Notice tone="danger">{failure}</Notice> : null}

          {stage === "READY_TO_APPROVE" && canApprove ? (
            <Button title="Approve report cards" loading={busy} disabled={busy} onPress={confirmApprove} />
          ) : null}
          {stage === "READY_TO_RELEASE" && canRelease ? (
            <Button title="Release to families" loading={busy} disabled={busy} onPress={confirmRelease} />
          ) : null}
          {stage === "WITH_TEACHERS" ? (
            <Notice tone="info">
              Every card has to be reviewed by its form teacher before you can approve this class.
            </Notice>
          ) : null}

          {stage !== "NOT_BUILT" && canReopen ? (
            reopening ? (
              <Card style={styles.band}>
                <Label>Why are you reopening this class?</Label>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  placeholder="e.g. Mathematics marks were entered wrongly"
                  placeholderTextColor={colors.mutedForeground}
                  accessibilityLabel="Reason for reopening"
                  style={[
                    styles.input,
                    { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                />
                <Label>
                  Every card in the class goes back to draft. The reason is kept in the school&apos;s
                  records.
                </Label>
                <Button
                  title="Reopen class"
                  loading={busy}
                  disabled={busy || reason.trim().length === 0}
                  onPress={() => transition.mutate("reopen")}
                />
                <Button title="Cancel" variant="secondary" onPress={() => setReopening(false)} />
              </Card>
            ) : (
              <Button title="Reopen for correction" variant="secondary" onPress={() => setReopening(true)} />
            )
          ) : null}

          {rows.length > 0 ? (
            <>
              <SectionHeader title="Students" note={`${rows.length}`} />
              {rows.map(({ student, reportCard }) => (
                <ListRow
                  key={reportCard.id}
                  icon="person-outline"
                  title={[student.firstName, student.lastName].filter(Boolean).join(" ")}
                  subtitle={`${student.admissionNumber} · ${reportCard.status.replace(/_/g, " ").toLowerCase()}`}
                />
              ))}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  band: { gap: spacing.xs },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    textAlignVertical: "top",
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
});
