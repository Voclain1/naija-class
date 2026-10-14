import { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import type { CbtInvigilatorSheetDto } from "@school-kit/types";

import { LoadError } from "../../../../src/components/load-error";
import { staffCbtCandidates, staffCbtInvigilatorSheet } from "../../../../src/lib/api/staff-cbt";
import { queryKeys } from "../../../../src/lib/query/keys";
import { useSession } from "../../../../src/lib/auth/session";
import { hasPermission } from "../../../../src/lib/auth/permissions";
import {
  cbtExamUrl,
  describeSittingTime,
  invigilatorSheetHtml,
  invigilatorSteps,
} from "../../../../src/lib/staff/cbt-format";
import { useTheme } from "../../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../../src/theme/tokens";
import { Body, Button, Caption, Card, Heading, Notice, Screen } from "../../../../src/components/ui";
import { ScreenHeader, SectionHeader, Skeleton } from "../../../../src/components/layout";

// The invigilator sheet (docs/modules/cbt.md D3) — the website's
// /teacher/cbt/[id]/invigilator: where to open the exam, the access code to
// download it, the unlock code to start it, and the register.
//
// Opening this screen reveals the codes, and the server audits every reveal.
// So the sheet is fetched once, when the screen opens, and held in this
// screen's state only — not in the query cache (which could refetch it, and
// write another audit row, on focus or reconnect) and never on disk. Printing
// hands HTML straight to the print dialog; sharing writes a PDF to the cache
// for the share sheet and deletes it as soon as the sheet closes.

type SheetState =
  | { kind: "loading" }
  | { kind: "ready"; sheet: CbtInvigilatorSheetDto }
  | { kind: "failed"; error: unknown };

export default function InvigilatorSheetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const canManage = hasPermission(staff?.permissions ?? [], "cbt.manage");
  const sittingId = typeof id === "string" ? id : "";
  const ready = authed && canManage && schoolId !== "" && userId !== "" && sittingId !== "";

  const [state, setState] = useState<SheetState>({ kind: "loading" });
  const [busy, setBusy] = useState<"print" | "pdf" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const candidates = useQuery({
    queryKey: [...queryKeys.staffCbtExam(schoolId, userId, sittingId), "candidates"] as const,
    queryFn: () => staffCbtCandidates(sittingId),
    enabled: ready,
    staleTime: 15_000,
  });

  const load = useCallback(() => {
    let live = true;
    setState({ kind: "loading" });
    staffCbtInvigilatorSheet(sittingId)
      .then((sheet) => {
        if (live) setState({ kind: "ready", sheet });
      })
      .catch((error: unknown) => {
        if (live) setState({ kind: "failed", error });
      });
    return () => {
      live = false;
    };
  }, [sittingId]);

  useEffect(() => {
    if (!ready) return;
    return load();
  }, [ready, load]);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (!canManage) {
    return (
      <Screen>
        {header}
        <ScreenHeader title="Invigilator sheet" />
        <Notice tone="info">The codes are shown only to staff who manage online exams.</Notice>
      </Screen>
    );
  }

  if (state.kind === "failed") {
    return (
      <Screen>
        {header}
        <ScreenHeader title="Invigilator sheet" />
        <LoadError error={state.error} what="the invigilator sheet" onRetry={load} />
      </Screen>
    );
  }

  if (state.kind === "loading" || candidates.isPending) {
    return (
      <Screen>
        {header}
        <Skeleton lines={6} />
      </Screen>
    );
  }

  if (candidates.isError) {
    return (
      <Screen>
        {header}
        <ScreenHeader title="Invigilator sheet" />
        <LoadError error={candidates.error} what="the register" onRetry={() => void candidates.refetch()} />
      </Screen>
    );
  }

  const sheet = state.sheet;
  const register = candidates.data ?? [];
  const examUrl = cbtExamUrl(sheet.schoolSlug);
  const html = () => invigilatorSheetHtml(sheet, register);

  async function print(): Promise<void> {
    setBusy("print");
    setFailure(null);
    try {
      await Print.printAsync({ html: html() });
    } catch {
      setFailure("The print dialog couldn't open. Try again, or share it as a PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function sharePdf(): Promise<void> {
    setBusy("pdf");
    setFailure(null);
    let file: string | null = null;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setFailure("This phone can't share files. Use Print instead.");
        return;
      }
      const { uri } = await Print.printToFileAsync({ html: html() });
      file = uri;
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `Invigilator sheet — ${sheet.title}`, UTI: "com.adobe.pdf" });
    } catch {
      setFailure("The sheet couldn't be shared. Try again, or print it.");
    } finally {
      if (file) await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => undefined);
      setBusy(null);
    }
  }

  const codeBox = [styles.codeBox, { backgroundColor: colors.primary + "14" }];

  return (
    <Screen>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title={sheet.title} subtitle={`${sheet.schoolName} — invigilator sheet`} />
        <Body>
          {sheet.classLevelName} {sheet.subjectName} · {sheet.armNames.join(", ")}
        </Body>
        <Body>{describeSittingTime(sheet)}</Body>

        <Notice tone="warning">
          Keep this sheet private. The unlock code opens the exam questions. Do not write it on the board or leave this sheet
          where students can see it.
        </Notice>

        <View style={codeBox}>
          <Caption>Access code — to download the exam onto each computer</Caption>
          <Text selectable={false} style={[styles.code, { color: colors.foreground }]} accessibilityLabel={`Access code ${sheet.accessCode}`}>
            {sheet.accessCode}
          </Text>
        </View>
        <View style={codeBox}>
          <Caption>Unlock code — type it on each computer at the start</Caption>
          <Text selectable={false} style={[styles.code, { color: colors.foreground }]} accessibilityLabel={`Unlock code ${sheet.unlockCode}`}>
            {sheet.unlockCode}
          </Text>
        </View>

        {failure ? <Notice tone="danger">{failure}</Notice> : null}
        <Button title="Print" loading={busy === "print"} disabled={busy !== null} onPress={() => void print()} />
        <Button title="Share as PDF" variant="secondary" loading={busy === "pdf"} disabled={busy !== null} onPress={() => void sharePdf()} />

        <Card style={styles.card}>
          <Heading>On the day</Heading>
          {invigilatorSteps(examUrl, sheet.durationMinutes).map((step, index) => (
            <Text key={index} style={[styles.step, { color: colors.foreground }]}>
              {`${index + 1}. `}
              {step.lead ? <Text style={styles.bold}>{step.lead}</Text> : null}
              {step.rest}
            </Text>
          ))}
        </Card>

        <SectionHeader title={`Register (${sheet.candidateCount})`} />
        {register.map((c) => (
          <Card key={c.studentId} style={styles.row}>
            <Body>
              {c.lastName}, {c.firstName}
            </Body>
            <Caption>
              {c.admissionNumber} · {c.armName} · Version {c.version}
            </Caption>
          </Card>
        ))}
        <Caption>The printed sheet adds a column for each student&apos;s computer and signature.</Caption>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  card: { gap: spacing.sm },
  row: { gap: spacing.xs, minWidth: 0 },
  codeBox: { borderRadius: radii.md, padding: spacing.md, gap: spacing.xs, minWidth: 0 },
  // Monospace so 0/O and 1/I read apart; wraps rather than running off a
  // 320-point screen (the unlock code is 14 characters with its dashes).
  code: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: fontSizes.title, letterSpacing: 2, flexShrink: 1 },
  step: { fontFamily: fonts.sans, fontSize: fontSizes.body, lineHeight: Math.round(fontSizes.body * 1.45) },
  bold: { fontFamily: fonts.sansSemibold },
});
