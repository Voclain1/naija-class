import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { formatKobo } from "@school-kit/types";

import { useSession } from "../../../src/lib/auth/session";
import { koboInWords, moneyAbilities } from "../../../src/lib/staff/money";
import { spacing } from "../../../src/theme/tokens";
import { Card, Notice, Screen } from "../../../src/components/ui";
import { ScreenHeader, StatRow } from "../../../src/components/layout";
import { ReceiptActions } from "../../../src/components/receipt-actions";

// One receipt: share it as a PDF, print it, or re-issue it in the current
// design (same number, date and amount — audited on the server).
//
// The figures shown here come from the list row the admin tapped; the
// document shared is always the server's own copy, fetched fresh.

export default function ReceiptScreen() {
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ paymentId: string; receiptNumber?: string; studentName?: string; amount?: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const abilities = moneyAbilities(staff?.roles, staff?.permissions ?? []);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (!abilities.viewReceipts || !params.paymentId) {
    return (
      <Screen>
        {header}
        <Notice tone="info">Receipts are issued by owners, administrators and bursars.</Notice>
      </Screen>
    );
  }

  const amount = Number(params.amount);
  const hasAmount = Number.isSafeInteger(amount) && amount > 0;

  return (
    <Screen>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title={params.receiptNumber ? `Receipt ${params.receiptNumber}` : "Receipt"} subtitle={params.studentName ?? null} />
        {hasAmount ? (
          <Card style={styles.card}>
            <StatRow icon="cash-outline" value={formatKobo(amount)} label={koboInWords(amount)} />
          </Card>
        ) : null}
        <ReceiptActions
          paymentId={params.paymentId}
          receiptNumber={params.receiptNumber ?? null}
          canReissue={abilities.reissueReceipt}
          onReissued={() => void queryClient.invalidateQueries({ queryKey: ["staff", staff?.school.id ?? "", staff?.user.id ?? "", "receipts"] })}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  card: { gap: spacing.xs },
});
