import { useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import {
  formatKobo,
  type DebtorDto,
  type ManualPaymentMethod,
  type ManualPaymentResultDto,
  type RecordManualPaymentInput,
} from "@school-kit/types";

import { staffDebtors } from "../../../src/lib/api/staff-finance";
import { staffRecordPayment } from "../../../src/lib/api/staff-money";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { serverNowMs, serverToday } from "../../../src/lib/staff/server-date";
import { isoDateFromParts } from "../../../src/lib/staff/student-form";
import {
  PAYMENT_METHOD_OPTIONS,
  koboInWords,
  moneyAbilities,
  nairaParseMessage,
  nairaToKobo,
  paidAtFor,
} from "../../../src/lib/staff/money";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, CenteredMessage, Label, Notice, Screen } from "../../../src/components/ui";
import { ScreenHeader, Skeleton, StatRow } from "../../../src/components/layout";
import { ChoiceChips, DateBoxes, TextField, type DateBoxValues } from "../../../src/components/form";
import { ReceiptActions } from "../../../src/components/receipt-actions";

// CP9b / D37 + D38 — record money received, from the phone.
//
// The reason this screen can exist at all is D37: every payment form carries
// ONE idempotency key, made when the form opens. When the admin confirms, the
// exact request — key, amount, method, paidAt — is FROZEN, and "Try again"
// resends that frozen request byte for byte. So a reply lost on a bad network
// can be retried safely: if the first attempt got through, the server answers
// with the same payment (replayed) and records nothing new.
//
// Once a request may have reached the server, the form LOCKS. Editing the
// amount and resending under the same key would be a different payment with a
// used key (409), and under a new key could be a genuine double. So the only
// choices are "Try again" (safe, same request) or "Start over", which warns.
//
// The phone computes no balance: the outstanding figure is the server's, and
// the server re-checks the amount against it (PAYMENT_WOULD_EXCEED_BALANCE).

type Step = "form" | "sending" | "uncertain" | "done";

function newKey(): string {
  return Crypto.randomUUID();
}

export default function RecordPaymentScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { invoiceId, termId } = useLocalSearchParams<{ invoiceId: string; termId: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const abilities = moneyAbilities(staff?.roles, staff?.permissions ?? []);

  const debtors = useQuery({
    queryKey: queryKeys.staffDebtors(schoolId, userId, termId ?? ""),
    queryFn: () => staffDebtors(termId as string),
    enabled: authed && abilities.recordPayment && schoolId !== "" && !!termId,
    staleTime: 15_000,
  });
  const liveRow = debtors.data?.find((d) => d.invoiceId === invoiceId) ?? null;
  // The row as it was when the admin confirmed. If the first attempt DID go
  // through and cleared the balance, the family leaves the debtor list — the
  // retry card must not vanish with it.
  const snapshot = useRef<DebtorDto | null>(null);
  const row = liveRow ?? snapshot.current;

  const keyRef = useRef<string>(newKey());
  const frozen = useRef<(RecordManualPaymentInput & { idempotencyKey: string }) | null>(null);

  const [step, setStep] = useState<Step>("form");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<ManualPaymentMethod | null>(null);
  const [reference, setReference] = useState("");
  const [otherDay, setOtherDay] = useState(false);
  const [date, setDate] = useState<DateBoxValues>({ day: "", month: "", year: "" });
  const [errors, setErrors] = useState<Partial<Record<"amount" | "method" | "date" | "reference", string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<ManualPaymentResultDto | null>(null);

  const record = useMutation({
    mutationFn: () => staffRecordPayment(frozen.current!),
    onMutate: () => {
      setFailure(null);
      setStep("sending");
    },
    onSuccess: async (payment) => {
      setResult(payment);
      setStep("done");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["staff", schoolId, userId, "debtors"] }),
        queryClient.invalidateQueries({ queryKey: ["staff", schoolId, userId, "collections"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.staffPaymentLink(schoolId, userId, invoiceId ?? "") }),
      ]);
    },
    onError: (error) => {
      if (error instanceof ApiNetworkError) {
        // It may or may not have landed. Only the frozen request may go again.
        setStep("uncertain");
        return;
      }
      // A definite answer from the server: nothing was recorded.
      setStep("form");
      frozen.current = null;
      keyRef.current = newKey();
      if (error instanceof ApiError) {
        if (error.code === "PAYMENT_WOULD_EXCEED_BALANCE") {
          setFailure(`${error.message} Nothing was recorded.`);
        } else if (error.code === "INVOICE_NOT_PAYABLE") {
          setFailure("This invoice can no longer take payments (it was cancelled or refunded). Nothing was recorded.");
        } else if (error.code === "IDEMPOTENCY_KEY_REUSED") {
          setFailure("This form had already recorded a different payment. It has been reset — check the balance before recording again.");
        } else {
          setFailure(`${error.message || "The payment could not be recorded."} Nothing was recorded.`);
        }
      } else {
        setFailure("The payment could not be recorded. Nothing was recorded.");
      }
    },
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (!abilities.recordPayment) {
    return (
      <Screen>
        {header}
        <Notice tone="info">Your account can&apos;t record payments.</Notice>
      </Screen>
    );
  }

  if (step === "done" && result) {
    return (
      <Screen>
        {header}
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title="Payment recorded" subtitle={row?.studentName ?? null} />
          <Card style={styles.card}>
            <StatRow icon="checkmark-circle-outline" value={formatKobo(result.amount)} label={koboInWords(result.amount)} />
            {result.receiptNumber ? <StatRow icon="receipt-outline" value={result.receiptNumber} label="Receipt number" /> : null}
          </Card>
          {result.replayed ? (
            <Notice tone="info">
              Your first attempt had already got through, so this is that same payment. Nothing was recorded twice.
            </Notice>
          ) : null}
          {abilities.viewReceipts ? (
            <ReceiptActions paymentId={result.id} receiptNumber={result.receiptNumber} />
          ) : null}
          <Button title="Back to the family" variant="secondary" onPress={() => router.back()} />
        </ScrollView>
      </Screen>
    );
  }

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
          <Notice tone="info">This invoice has nothing outstanding — it may have just been paid.</Notice>
          <Button title="Back" variant="secondary" onPress={() => router.back()} />
        </CenteredMessage>
      </Screen>
    );
  }

  const balance = row.balance;
  const parsed = nairaToKobo(amount);
  const locked = step !== "form";

  function validate(): RecordManualPaymentInput | null {
    const found: typeof errors = {};
    const p = nairaToKobo(amount);
    if (!p.ok) found.amount = nairaParseMessage(p.reason);
    else if (p.kobo > balance) {
      found.amount = `That is more than the ${formatKobo(balance)} outstanding. Check the amount.`;
    }
    if (!method) found.method = "Choose how the money was paid.";
    let dateIso: string | null = null;
    if (otherDay) {
      dateIso = isoDateFromParts(date.day, date.month, date.year);
      const today = serverToday();
      if (!dateIso) found.date = "Enter a real date — day, month, year.";
      else if (today && dateIso > today) found.date = "A payment can't be received in the future.";
    }
    if (reference.trim().length > 200) found.reference = "Keep the reference under 200 characters.";
    setErrors(found);
    if (Object.keys(found).length > 0 || !p.ok || !method) return null;
    return {
      invoiceId: row!.invoiceId,
      amount: p.kobo,
      method,
      paidAt: paidAtFor(otherDay ? dateIso : null, serverNowMs() ?? Date.now()),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    };
  }

  function confirm(): void {
    const input = validate();
    if (!input) return;
    const methodLabel = PAYMENT_METHOD_OPTIONS.find((o) => o.value === input.method)?.label ?? input.method;
    Alert.alert(
      "Record this payment?",
      `${formatKobo(input.amount)}\n${koboInWords(input.amount)}\n\nFrom ${row!.studentName}'s family, by ${methodLabel.toLowerCase()}, ${
        otherDay ? `received ${input.paidAt.slice(0, 10)}` : "received today"
      }.\n\nThis goes into the school's books and cannot be edited from the phone.`,
      [
        { text: "Go back", style: "cancel" },
        {
          text: "Record",
          onPress: () => {
            // Freeze the exact request; every retry resends this, unchanged.
            frozen.current = { ...input, idempotencyKey: keyRef.current };
            snapshot.current = row;
            record.mutate();
          },
        },
      ],
    );
  }

  function startOver(): void {
    Alert.alert(
      "Start over?",
      "The last attempt may have been recorded. Before recording again, check the family's balance — if it has already gone down, the payment went through.",
      [
        { text: "Keep trying", style: "cancel" },
        {
          text: "Start over",
          style: "destructive",
          onPress: () => {
            frozen.current = null;
            snapshot.current = null;
            keyRef.current = newKey();
            setStep("form");
            void debtors.refetch();
          },
        },
      ],
    );
  }

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader title="Record a payment" subtitle={`${row.studentName} · ${row.classArm}`} />

          <Card style={styles.card}>
            <StatRow icon="wallet-outline" value={formatKobo(balance)} label="Outstanding now" tone="warning" />
          </Card>

          {step === "uncertain" ? (
            <Card style={styles.card}>
              <Notice tone="warning">
                Your phone lost the connection before the school&apos;s server answered. The payment may or may not
                have been recorded.
              </Notice>
              <Body>
                Trying again is safe: it sends the very same payment, and if the first attempt got through, nothing is
                recorded twice.
              </Body>
              <Button title="Try again" onPress={() => record.mutate()} />
              <Button title="Start over" variant="secondary" onPress={startOver} />
            </Card>
          ) : null}

          <Card style={styles.card}>
            <TextField
              label="Amount received (₦)"
              value={amount}
              onChangeText={locked ? () => undefined : setAmount}
              keyboardType="decimal-pad"
              placeholder="e.g. 50000"
              error={errors.amount}
            />
            {parsed.ok ? <Label>{`${formatKobo(parsed.kobo)} — ${koboInWords(parsed.kobo)}`}</Label> : null}
            {!locked ? (
              <Button
                title={`Full balance (${formatKobo(balance)})`}
                variant="secondary"
                // The server's figure, written out as naira text — no arithmetic.
                onPress={() => setAmount(formatKobo(balance).replace(/[₦,]/g, ""))}
              />
            ) : null}
            <ChoiceChips<ManualPaymentMethod>
              label="Paid by"
              options={PAYMENT_METHOD_OPTIONS}
              value={method}
              onChange={locked ? () => undefined : setMethod}
              error={errors.method}
            />
            <TextField
              label={method === "BANK_TRANSFER" ? "Transfer reference (optional)" : method === "POS" ? "POS reference (optional)" : "Reference (optional)"}
              value={reference}
              onChangeText={locked ? () => undefined : setReference}
              error={errors.reference}
            />
            <ChoiceChips<"today" | "other">
              label="Received"
              options={[
                { value: "today", label: "Today" },
                { value: "other", label: "Another day" },
              ]}
              value={otherDay ? "other" : "today"}
              onChange={locked ? () => undefined : (v) => setOtherDay(v === "other")}
            />
            {otherDay ? <DateBoxes label="Date received" value={date} onChange={locked ? () => undefined : setDate} error={errors.date} /> : null}
          </Card>

          {failure ? <Notice tone="danger">{failure}</Notice> : null}

          {step === "form" ? <Button title="Record payment" onPress={confirm} /> : null}
          {step === "sending" ? <Button title="Recording…" loading onPress={() => undefined} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  card: { gap: spacing.md },
});
