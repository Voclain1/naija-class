import { useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { formatKobo, type ExpenseDto } from "@school-kit/types";

import {
  staffCreateExpense,
  staffExpenseCategories,
  staffUploadExpenseReceipt,
} from "../../../src/lib/api/staff-money";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { serverToday } from "../../../src/lib/staff/server-date";
import { isoDateFromParts } from "../../../src/lib/staff/student-form";
import { koboInWords, moneyAbilities, nairaParseMessage, nairaToKobo } from "../../../src/lib/staff/money";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, Label, Notice, Screen } from "../../../src/components/ui";
import { ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";
import { ChoiceChips, DateBoxes, TextField, type DateBoxValues } from "../../../src/components/form";

// CP9b / D38 — log an expense, with a photo of the receipt.
//
// Safeguards, in the order the admin meets them:
//  - The amount is typed in naira and converted to kobo by exact string
//    arithmetic (money.ts) — never a float — and anything odd is refused,
//    not rounded.
//  - Saving asks for confirmation with the amount in figures AND words.
//  - The receipt goes up AFTER the expense is saved (the API's own two-step
//    design). If the photo fails, the expense is kept and only the photo is
//    retried — never the expense.
//  - Expenses carry no idempotency key yet (D37 covered payments). So when
//    the phone loses the reply to a save, the screen does NOT offer a plain
//    retry: it says the expense may already be saved and asks for a
//    deliberate "save anyway". A blind second tap is how books get doubled.

interface Receipt {
  uri: string;
  mimeType: string;
  isImage: boolean;
  name: string;
}

const RECEIPT_MIME = new Set(["image/jpeg", "image/png", "application/pdf"]);

function partsOf(date: string | null): DateBoxValues {
  if (!date) return { day: "", month: "", year: "" };
  const [y, m, d] = date.split("-");
  return { day: String(Number(d)), month: String(Number(m)), year: y ?? "" };
}

export default function LogExpenseScreen() {
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const abilities = moneyAbilities(staff?.roles, staff?.permissions ?? []);

  const categories = useQuery({
    queryKey: queryKeys.staffExpenseCategories(schoolId, userId),
    queryFn: () => staffExpenseCategories(),
    enabled: authed && abilities.logExpense && schoolId !== "",
    staleTime: 5 * 60_000,
  });

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<DateBoxValues>(() => partsOf(serverToday()));
  const [description, setDescription] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [errors, setErrors] = useState<Partial<Record<"category" | "amount" | "date" | "description", string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [mayBeSaved, setMayBeSaved] = useState(false);
  const [saved, setSaved] = useState<ExpenseDto | null>(null);
  const [receiptAttached, setReceiptAttached] = useState(false);

  const upload = useMutation({
    mutationFn: (args: { expenseId: string; file: Receipt }) =>
      staffUploadExpenseReceipt(args.expenseId, { uri: args.file.uri, mimeType: args.file.mimeType }),
    onMutate: () => setFailure(null),
    onSuccess: () => setReceiptAttached(true),
    onError: (error) =>
      setFailure(
        error instanceof ApiError && error.status === 413
          ? "The receipt is larger than 8 MB. Take the photo again, or choose a smaller file."
          : "The expense is saved, but the receipt didn't upload. Try attaching it again.",
      ),
  });

  const create = useMutation({
    mutationFn: (input: { categoryId: string; amount: number; incurredAt: string; description?: string }) =>
      staffCreateExpense(input),
    onMutate: () => setFailure(null),
    onSuccess: (expense) => {
      setSaved(expense);
      setMayBeSaved(false);
      if (receipt) upload.mutate({ expenseId: expense.id, file: receipt });
    },
    onError: (error) => {
      if (error instanceof ApiNetworkError) {
        setMayBeSaved(true);
        setFailure(
          "Your phone lost the connection while saving. The expense MAY already be saved — check the expenses list on the website before saving it again.",
        );
        return;
      }
      setFailure(error instanceof ApiError ? error.message : "The expense could not be saved.");
    },
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;

  if (!abilities.logExpense) {
    return (
      <Screen>
        {header}
        <Notice tone="info">Your account can&apos;t log expenses.</Notice>
      </Screen>
    );
  }

  async function takePhoto(fromCamera: boolean): Promise<void> {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setFailure(fromCamera ? "School Kit needs the camera to photograph the receipt." : "School Kit needs your photos to attach the receipt.");
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6, exif: false };
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    const mimeType = asset.mimeType === "image/png" ? "image/png" : "image/jpeg";
    setReceipt({ uri: asset.uri, mimeType, isImage: true, name: "Receipt photo" });
  }

  async function choosePdf(): Promise<void> {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    const mimeType = asset.mimeType ?? "application/pdf";
    if (!RECEIPT_MIME.has(mimeType)) {
      setFailure("A receipt must be a photo (JPEG or PNG) or a PDF.");
      return;
    }
    setReceipt({ uri: asset.uri, mimeType, isImage: false, name: asset.name });
  }

  function validate(): { categoryId: string; kobo: number; incurredAt: string } | null {
    const found: typeof errors = {};
    const parsed = nairaToKobo(amount);
    if (!parsed.ok) found.amount = nairaParseMessage(parsed.reason);
    if (!categoryId) found.category = "Choose what the money was spent on.";
    const incurredAt = isoDateFromParts(date.day, date.month, date.year);
    const today = serverToday();
    if (!incurredAt) found.date = "Enter a real date — day, month, year.";
    else if (today && incurredAt > today) found.date = "An expense can't be in the future.";
    if (description.trim().length > 500) found.description = "Keep the note under 500 characters.";
    setErrors(found);
    if (Object.keys(found).length > 0 || !parsed.ok || !categoryId || !incurredAt) return null;
    return { categoryId, kobo: parsed.kobo, incurredAt };
  }

  function confirmSave(): void {
    const v = validate();
    if (!v) return;
    const category = (categories.data ?? []).find((c) => c.id === v.categoryId)?.name ?? "";
    Alert.alert(
      mayBeSaved ? "Save anyway?" : "Save this expense?",
      `${formatKobo(v.kobo)} — ${koboInWords(v.kobo)}.\n${category}, ${v.incurredAt}.${receipt ? "\nWith a receipt." : "\nNo receipt attached."}${
        mayBeSaved ? "\n\nOnly save again if you have checked it was NOT saved the first time." : ""
      }`,
      [
        { text: "Go back", style: "cancel" },
        {
          text: mayBeSaved ? "Save anyway" : "Save",
          style: mayBeSaved ? "destructive" : "default",
          onPress: () =>
            create.mutate({
              categoryId: v.categoryId,
              amount: v.kobo,
              incurredAt: v.incurredAt,
              ...(description.trim() ? { description: description.trim() } : {}),
            }),
        },
      ],
    );
  }

  function startAnother(): void {
    setSaved(null);
    setReceiptAttached(false);
    setAmount("");
    setDescription("");
    setReceipt(null);
    setCategoryId(null);
    setFailure(null);
    setDate(partsOf(serverToday()));
  }

  if (saved) {
    return (
      <Screen>
        {header}
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title="Expense saved" subtitle={`${formatKobo(saved.amount)} · ${String(saved.incurredAt).slice(0, 10)}`} />
          {upload.isPending ? <Notice tone="info">Uploading the receipt…</Notice> : null}
          {receiptAttached ? <Notice tone="info">The receipt is attached.</Notice> : null}
          {failure ? <Notice tone="danger">{failure}</Notice> : null}
          {receipt && !receiptAttached && !upload.isPending && abilities.attachReceipt ? (
            <Button title="Attach the receipt again" onPress={() => upload.mutate({ expenseId: saved.id, file: receipt })} />
          ) : null}
          {receipt && !abilities.attachReceipt ? (
            <Notice tone="warning">Your account can save expenses but not attach receipts. Ask an administrator to add it.</Notice>
          ) : null}
          <Button title="Log another expense" variant="secondary" disabled={upload.isPending} onPress={startAnother} />
        </ScrollView>
      </Screen>
    );
  }

  const active = (categories.data ?? []).filter((c) => c.active);
  const parsed = nairaToKobo(amount);

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader title="Log an expense" subtitle="What the school spent, with a photo of the receipt." />

          <Card style={styles.card}>
            {categories.isPending ? <Skeleton lines={2} /> : null}
            {categories.data && active.length === 0 ? (
              <Body muted>There are no expense categories yet. Add them on the website first.</Body>
            ) : null}
            <ChoiceChips
              label="Spent on"
              options={active.map((c) => ({ value: c.id, label: c.name }))}
              value={categoryId}
              onChange={setCategoryId}
              error={errors.category}
            />
            <TextField
              label="Amount (₦)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="e.g. 15000"
              error={errors.amount}
            />
            {parsed.ok ? <Label>{`${formatKobo(parsed.kobo)} — ${koboInWords(parsed.kobo)}`}</Label> : null}
            <DateBoxes label="Date spent" value={date} onChange={setDate} error={errors.date} />
            <TextField
              label="Note (optional)"
              value={description}
              onChangeText={setDescription}
              multiline
              autoCapitalize="sentences"
              error={errors.description}
            />
          </Card>

          <SectionHeader title="Receipt" note={receipt ? "attached" : "optional"} />
          <Card style={styles.card}>
            {receipt ? (
              <View style={styles.receipt}>
                {receipt.isImage ? <Image source={{ uri: receipt.uri }} style={styles.preview} resizeMode="cover" /> : null}
                <Body>{receipt.name}</Body>
                <Button title="Remove" variant="secondary" onPress={() => setReceipt(null)} />
              </View>
            ) : (
              <>
                <Button title="Take a photo" onPress={() => void takePhoto(true)} />
                <Button title="Choose a photo" variant="secondary" onPress={() => void takePhoto(false)} />
                <Button title="Choose a PDF" variant="secondary" onPress={() => void choosePdf()} />
              </>
            )}
          </Card>

          {failure ? <Notice tone={mayBeSaved ? "warning" : "danger"}>{failure}</Notice> : null}

          <Button
            title={mayBeSaved ? "I've checked — save anyway" : "Save expense"}
            loading={create.isPending}
            disabled={create.isPending}
            onPress={confirmSave}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  card: { gap: spacing.md },
  receipt: { gap: spacing.sm },
  preview: { width: "100%", height: 220, borderRadius: 8 },
});
