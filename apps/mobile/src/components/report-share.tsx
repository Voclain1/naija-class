import { useState } from "react";
import { StyleSheet, View } from "react-native";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import type { AnalyticsExportReport } from "@school-kit/types";

import { ApiError, ApiNetworkError, apiUrl, bearerHeader } from "../lib/api/client";
import { analyticsExcelPath, staffReportExport, staffRequestAnalyticsPdf } from "../lib/api/staff-reports";
import { reportFileName, waitForReportPdf } from "../lib/staff/report-wait";
import { spacing } from "../theme/tokens";
import { Button, Notice } from "./ui";

// Phase 9 / CP1.3b — "Share as Excel" and "Share as PDF" for a report tab
// (docs/modules/phase-9.md §8.3). The files are the same ones the website
// downloads, built by the API.
//
// A report names students, so the file goes to the phone's CACHE and is
// DELETED as soon as the share sheet closes — staff data is never kept on the
// device (the CP2 rule receipts follow too).

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function describeFailure(error: unknown): string {
  if (error instanceof ApiNetworkError) return "Your phone couldn't reach the server. Try again when you have signal.";
  if (error instanceof ApiError) {
    if (error.status === 403) return "Report copies are for owners and administrators.";
    return error.message || "The file could not be made.";
  }
  return "The file could not be made. Try again.";
}

export function ReportShare({
  report,
  termId,
  termName,
  yearLabel,
}: {
  report: AnalyticsExportReport;
  termId?: string;
  termName: string | null;
  yearLabel: string | null;
}) {
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const [message, setMessage] = useState<{ tone: "danger" | "info"; text: string } | null>(null);

  async function shareFile(remoteUrl: string, headers: Record<string, string>, ext: "xlsx" | "pdf"): Promise<void> {
    const name = reportFileName(report, termName, yearLabel, ext);
    const target = `${FileSystem.cacheDirectory ?? ""}${name}`;
    let saved: string | null = null;
    try {
      const result = await FileSystem.downloadAsync(remoteUrl, target, { headers });
      saved = result.uri;
      if (result.status !== 200) throw new Error(`download failed with ${result.status}`);
      if (!(await Sharing.isAvailableAsync())) {
        setMessage({ tone: "danger", text: "This phone can't share files." });
        return;
      }
      await Sharing.shareAsync(result.uri, {
        mimeType: ext === "xlsx" ? XLSX_MIME : "application/pdf",
        dialogTitle: name,
        UTI: ext === "xlsx" ? "org.openxmlformats.spreadsheetml.sheet" : "com.adobe.pdf",
      });
    } finally {
      if (saved) await FileSystem.deleteAsync(saved, { idempotent: true }).catch(() => undefined);
    }
  }

  async function excel(): Promise<void> {
    setBusy("xlsx");
    setMessage(null);
    try {
      await shareFile(apiUrl(analyticsExcelPath(report, termId)), bearerHeader(), "xlsx");
    } catch (error) {
      setMessage({ tone: "danger", text: describeFailure(error) });
    } finally {
      setBusy(null);
    }
  }

  async function pdf(): Promise<void> {
    setBusy("pdf");
    setMessage({ tone: "info", text: "Preparing the PDF… this can take up to a minute." });
    try {
      const { exportId } = await staffRequestAnalyticsPdf(report, termId);
      const done = await waitForReportPdf(exportId, staffReportExport);
      if (done.status === "GENERATED" && done.url) {
        setMessage(null);
        // A short-lived signed link: no bearer header, and none should be sent to the file store.
        await shareFile(done.url, {}, "pdf");
      } else if (done.status === "FAILED") {
        setMessage({ tone: "danger", text: "The PDF could not be made. Try again, or share Excel instead." });
      } else {
        setMessage({ tone: "info", text: "The PDF is still being made. Try again in a minute." });
      }
    } catch (error) {
      setMessage({ tone: "danger", text: describeFailure(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.cell}>
          <Button
            title={busy === "xlsx" ? "Preparing…" : "Share as Excel"}
            variant="secondary"
            disabled={busy !== null}
            onPress={() => void excel()}
          />
        </View>
        <View style={styles.cell}>
          <Button
            title={busy === "pdf" ? "Preparing…" : "Share as PDF"}
            variant="secondary"
            disabled={busy !== null}
            onPress={() => void pdf()}
          />
        </View>
      </View>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  cell: { flexGrow: 1, flexBasis: 140 },
});
