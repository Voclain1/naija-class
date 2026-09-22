import { useState } from "react";
import { StyleSheet, View } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";

import { staffFetchReceiptHtml, staffReissueReceipt } from "../lib/api/staff-money";
import { ApiError, ApiNetworkError } from "../lib/api/client";
import { receiptFileName } from "../lib/staff/money";
import { spacing } from "../theme/tokens";
import { Button, Notice } from "./ui";

// Branded receipts on the phone (docs/modules/branded-receipts.md D6).
//
// Share: the receipt the server issued is fetched, turned into a PDF on the
// phone, and handed to the share sheet (WhatsApp, usually). The PDF is written
// to the phone's cache and DELETED once the share sheet closes — a receipt
// carries a child's name and a payment, and staff data is never kept on the
// device (CP2 rule).
//
// Print: the same document through the system print dialog, which on Android
// also offers "Save as PDF".
//
// Nothing here renders or recomputes a receipt: the document is the server's
// snapshot, byte for byte.

function describeFailure(error: unknown): string {
  if (error instanceof ApiNetworkError) return "Your phone couldn't reach the server. Try again when you have signal.";
  if (error instanceof ApiError) {
    if (error.code === "RECEIPT_NOT_READY") return "The receipt is still being prepared. Try again in a moment.";
    if (error.status === 403) return "Receipts are issued by owners, administrators and bursars.";
    return error.message || "The receipt could not be opened.";
  }
  return "The receipt could not be opened. Try again.";
}

export function ReceiptActions({
  paymentId,
  receiptNumber,
  canReissue = false,
  onReissued,
}: {
  paymentId: string;
  receiptNumber: string | null;
  canReissue?: boolean;
  onReissued?: () => void;
}) {
  const [busy, setBusy] = useState<"share" | "print" | "reissue" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function share(): Promise<void> {
    setBusy("share");
    setFailure(null);
    setNotice(null);
    let file: string | null = null;
    try {
      const html = await staffFetchReceiptHtml(paymentId);
      const { uri } = await Print.printToFileAsync({ html });
      file = uri;
      if (!(await Sharing.isAvailableAsync())) {
        setFailure("This phone can't share files. Use Print instead.");
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle: receiptFileName(receiptNumber),
        UTI: "com.adobe.pdf",
      });
    } catch (error) {
      setFailure(describeFailure(error));
    } finally {
      if (file) await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => undefined);
      setBusy(null);
    }
  }

  async function print(): Promise<void> {
    setBusy("print");
    setFailure(null);
    setNotice(null);
    try {
      await Print.printAsync({ html: await staffFetchReceiptHtml(paymentId) });
    } catch (error) {
      setFailure(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  async function reissue(): Promise<void> {
    setBusy("reissue");
    setFailure(null);
    setNotice(null);
    try {
      const result = await staffReissueReceipt(paymentId);
      setNotice(`Receipt ${result.receiptNumber} re-issued in the current design — same number, date and amount.`);
      onReissued?.();
    } catch (error) {
      setFailure(describeFailure(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.group}>
      <Button title="Share receipt (PDF)" loading={busy === "share"} disabled={busy !== null} onPress={() => void share()} />
      <Button title="Print receipt" variant="secondary" loading={busy === "print"} disabled={busy !== null} onPress={() => void print()} />
      {canReissue ? (
        <Button
          title="Re-issue in the current design"
          variant="secondary"
          loading={busy === "reissue"}
          disabled={busy !== null}
          onPress={() => void reissue()}
        />
      ) : null}
      {notice ? <Notice tone="info">{notice}</Notice> : null}
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
});
