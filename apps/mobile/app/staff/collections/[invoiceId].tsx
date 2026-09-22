import { useState } from "react";
import { Alert, Linking, ScrollView, Share, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildNoRecipientWhatsAppUrl,
  buildPaymentLinkMessage,
  formatKobo,
  type PaymentLinkStateDto,
} from "@school-kit/types";

import { staffDebtors } from "../../../src/lib/api/staff-finance";
import { staffCreatePaymentLink, staffPaymentLink, staffSendReminders } from "../../../src/lib/api/staff-money";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { moneyAbilities } from "../../../src/lib/staff/money";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, CenteredMessage, Label, Notice, Screen } from "../../../src/components/ui";
import { ScreenHeader, SectionHeader, Skeleton, StatRow } from "../../../src/components/layout";

// CP9b — one family's unpaid invoice, and the three things a bursar does
// about it from the phone: record money received, remind the family, and
// send them a link to pay online.
//
// Every figure on this screen is the server's (DebtorDto.balance is computed
// server-side). The phone adds nothing up.
//
// The payment link is shared only when it is LIVE and made for EXACTLY the
// current balance — the same rule as the website's shareablePaymentLinkUrl.
// A link for an older balance would ask the parent for the wrong amount.

function describeFailure(error: unknown, what: string): string {
  if (error instanceof ApiNetworkError) {
    return `Your phone couldn't reach the server, so the ${what} was not sent. Try again when you have signal.`;
  }
  if (error instanceof ApiError) return error.message || `The ${what} could not be sent.`;
  return `The ${what} could not be sent.`;
}

function linkNote(state: PaymentLinkStateDto | undefined, balance: number): string | null {
  if (!state) return null;
  switch (state.state) {
    case "CONNECT_PAYSTACK":
      return "Online payment isn't set up for your school yet. The owner can connect Paystack on the website.";
    case "CREATING":
      return "The payment link is being prepared. Check again in a minute.";
    case "RETRYABLE_FAILURE":
      return "The last attempt to make a payment link failed. You can try again.";
    case "LIVE":
      return state.amount === balance
        ? null
        : `The current link asks for ${formatKobo(state.amount)}, not the balance of ${formatKobo(balance)}. It is replaced automatically after a payment — check again shortly.`;
    case "NOT_CREATED":
      return null;
  }
}

export default function DebtorScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { invoiceId, termId } = useLocalSearchParams<{ invoiceId: string; termId: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const abilities = moneyAbilities(staff?.roles, staff?.permissions ?? []);
  const ready = authed && schoolId !== "" && !!termId && !!invoiceId;

  const debtors = useQuery({
    queryKey: queryKeys.staffDebtors(schoolId, userId, termId ?? ""),
    queryFn: () => staffDebtors(termId as string),
    enabled: ready,
    staleTime: 30_000,
  });
  const row = debtors.data?.find((d) => d.invoiceId === invoiceId) ?? null;

  const linkKey = queryKeys.staffPaymentLink(schoolId, userId, invoiceId ?? "");
  const link = useQuery({
    queryKey: linkKey,
    queryFn: () => staffPaymentLink(invoiceId as string),
    enabled: ready && abilities.paymentLink,
    staleTime: 15_000,
    retry: false,
  });

  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const remind = useMutation({
    mutationFn: () => staffSendReminders(termId as string, [row!.studentId]),
    onMutate: () => {
      setNotice(null);
      setFailure(null);
    },
    onSuccess: (result) =>
      setNotice(
        result.sent > 0
          ? "Reminder sent to the family's main contact."
          : "No reminder went out — the family has no main contact the school can reach, or no message channel is switched on.",
      ),
    onError: (error) => setFailure(describeFailure(error, "reminder")),
  });

  const createLink = useMutation({
    mutationFn: () => staffCreatePaymentLink(invoiceId as string),
    onMutate: () => {
      setNotice(null);
      setFailure(null);
    },
    onSuccess: (state) => queryClient.setQueryData(linkKey, state),
    onError: (error) => setFailure(describeFailure(error, "payment link")),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (debtors.isPending) {
    return (
      <Screen>
        {header}
        <Skeleton lines={5} />
      </Screen>
    );
  }

  if (!row) {
    return (
      <Screen>
        {header}
        <CenteredMessage>
          <Notice tone="info">
            {debtors.isError
              ? "We couldn't load this invoice. Try again shortly."
              : "This invoice is no longer unpaid — it may have just been settled."}
          </Notice>
          <Button title="Back to the list" variant="secondary" onPress={() => router.back()} />
        </CenteredMessage>
      </Screen>
    );
  }

  const state = link.data;
  const shareable: Extract<PaymentLinkStateDto, { state: "LIVE" }> | null =
    state?.state === "LIVE" && state.amount === row.balance ? state : null;
  const note = linkNote(state, row.balance);
  const busy = remind.isPending || createLink.isPending;

  function confirmRemind(): void {
    Alert.alert(
      "Send a fee reminder?",
      `${row!.studentName}'s family is reminded of ${formatKobo(row!.balance)} outstanding, through the channels your school has switched on (app notification, email, text). Texts are charged to the school.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send", onPress: () => remind.mutate() },
      ],
    );
  }

  function shareLink(): void {
    if (!shareable) return;
    const message = buildPaymentLinkMessage({
      schoolName: shareable.schoolName,
      studentLabel: shareable.studentLabel,
      amount: shareable.amount,
      url: shareable.url,
    });
    const whatsapp = buildNoRecipientWhatsAppUrl(message);
    // wa.me opens WhatsApp when it is installed (the admin picks the chat —
    // there is no recipient in the URL) and a browser page otherwise; if even
    // that fails, the phone's own share sheet.
    Linking.openURL(whatsapp).catch(() => void Share.share({ message }));
  }

  return (
    <Screen>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title={row.studentName} subtitle={`${row.classArm} · ${row.admissionNumber}`} />

        <Card style={styles.card}>
          <StatRow icon="wallet-outline" value={formatKobo(row.balance)} label="Outstanding" tone="warning" />
          <StatRow icon="checkmark-done-outline" value={formatKobo(row.totalPaid)} label={`Paid of ${formatKobo(row.totalDue)}`} />
          {row.dueDate ? <StatRow icon="calendar-outline" value={row.dueDate} label="Due" /> : null}
          {row.hasPaymentPlan ? <Label>On a payment plan.</Label> : null}
        </Card>

        {notice ? <Notice tone="info">{notice}</Notice> : null}
        {failure ? <Notice tone="danger">{failure}</Notice> : null}

        {abilities.recordPayment ? (
          <Button
            title="Record money received"
            disabled={busy}
            onPress={() =>
              router.push({ pathname: "/staff/collections/pay", params: { invoiceId: row.invoiceId, termId } })
            }
          />
        ) : null}

        {abilities.remind ? (
          <Button title="Send a fee reminder" variant="secondary" loading={remind.isPending} disabled={busy} onPress={confirmRemind} />
        ) : null}

        {abilities.paymentLink ? (
          <>
            <SectionHeader title="Pay online" />
            <Card style={styles.card}>
              {link.isPending ? <Skeleton lines={2} /> : null}
              {link.isError ? <Body muted>We couldn&apos;t check the payment link just now.</Body> : null}
              {note ? <Body muted>{note}</Body> : null}
              {shareable ? (
                <>
                  <Body>A link to pay {formatKobo(shareable.amount)} online is ready.</Body>
                  <Button title="Share on WhatsApp" onPress={shareLink} />
                </>
              ) : null}
              {state?.state === "NOT_CREATED" || state?.state === "RETRYABLE_FAILURE" ? (
                <Button
                  title="Make a payment link"
                  variant="secondary"
                  loading={createLink.isPending}
                  disabled={busy}
                  onPress={() => createLink.mutate()}
                />
              ) : null}
              {state?.state === "CREATING" || (state?.state === "LIVE" && !shareable) ? (
                <Button title="Check again" variant="secondary" onPress={() => void link.refetch()} />
              ) : null}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  card: { gap: spacing.sm },
});
