import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, useNavigation } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import type { GeneratedResultPinBatchDto, ResultPinBatchDto } from "@school-kit/types";

import { LoadError } from "../../../src/components/load-error";
import {
  staffGenerateResultPins,
  staffResultPinBatches,
  staffVoidResultPin,
  staffVoidResultPinBatch,
} from "../../../src/lib/api/staff-result-pins";
import { staffAcademicYears, staffTermsOfYear } from "../../../src/lib/api/staff-finance";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { isSchoolAdmin } from "../../../src/lib/auth/roles";
import { hasPermission } from "../../../src/lib/auth/permissions";
import {
  parsePinBatchForm,
  pinBatchCsv,
  pinBatchFilename,
  pinBatchPrintHtml,
} from "../../../src/lib/staff/pin-export";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, Card, Heading, Label, Notice, Screen } from "../../../src/components/ui";
import { ScreenHeader, SectionHeader, Skeleton, StatRow } from "../../../src/components/layout";
import { ChoiceChips, TextField } from "../../../src/components/form";

// Result Checker PIN cards on the phone (docs/modules/phase-8.md §21.3), the
// website's /report-cards/pins brought to the app by the owner's decision on
// the pre-build audit (2026-10-14). Owner/admin.
//
// Generating a batch returns the PINs ONCE (D16). They are held in this
// screen's memory only, never in the query cache or on disk, until the admin
// shares them (a PDF of cut-out cards, or a CSV for a print shop) or prints
// them. The PDF or CSV is written to the phone's cache for the share sheet and
// deleted as soon as it closes. The PINs are never shown on screen: a phone is
// easily read over a shoulder, and the website does not list them either.
// Leaving with a batch unsaved asks first.

interface TermOption {
  value: string;
  label: string;
  current: boolean;
}

async function loadTermOptions(): Promise<TermOption[]> {
  const options: TermOption[] = [];
  for (const year of await staffAcademicYears()) {
    for (const term of await staffTermsOfYear(year.id)) {
      options.push({ value: term.id, label: `${term.name} · ${year.label}`, current: term.isCurrent });
    }
  }
  return options;
}

function describeFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiNetworkError) return "Your phone couldn't reach the server. Nothing changed. Try again when you have signal.";
  if (error instanceof ApiError) return error.message || fallback;
  return fallback;
}

export default function ResultPinsScreen() {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const allowed = isSchoolAdmin(staff?.roles) && hasPermission(staff?.permissions ?? [], "result-pin.read");
  const canManage = allowed && hasPermission(staff?.permissions ?? [], "result-pin.manage");
  const ready = authed && allowed && schoolId !== "" && userId !== "";

  const [termId, setTermId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("100");
  const [maxUses, setMaxUses] = useState("5");
  const [formError, setFormError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<GeneratedResultPinBatchDto | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "csv" | "print" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serial, setSerial] = useState("");

  const terms = useQuery({
    queryKey: queryKeys.staffTermOptions(schoolId, userId),
    queryFn: loadTermOptions,
    enabled: ready && canManage,
    staleTime: 10 * 60_000,
  });
  const batches = useQuery({
    queryKey: queryKeys.staffResultPinBatches(schoolId, userId),
    queryFn: staffResultPinBatches,
    enabled: ready,
    staleTime: 30_000,
  });

  // Default to the current term once the options arrive.
  useEffect(() => {
    if (termId !== null || !terms.data?.length) return;
    setTermId((terms.data.find((t) => t.current) ?? terms.data[0])!.value);
  }, [terms.data, termId]);

  // The PINs exist nowhere else: ask before leaving with them unsaved. A
  // forced sign-out is not stopped — the session is gone either way, and the
  // batch can be voided and made again.
  const unsaved = fresh !== null && !saved;
  useEffect(() => {
    if (!unsaved) return;
    return navigation.addListener("beforeRemove", (event) => {
      event.preventDefault();
      Alert.alert(
        "Leave without the PINs?",
        "These PINs have not been shared or printed, and they can't be shown again. If you leave, void the batch and make a new one.",
        [
          { text: "Stay", style: "cancel" },
          { text: "Leave", style: "destructive", onPress: () => navigation.dispatch(event.data.action) },
        ],
      );
    });
  }, [navigation, unsaved]);

  const refreshBatches = () => queryClient.invalidateQueries({ queryKey: queryKeys.staffResultPinBatches(schoolId, userId) });

  const generate = useMutation({
    mutationFn: (input: { termId: string; quantity: number; maxUses: number }) => staffGenerateResultPins(input),
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: async (generated) => {
      setFresh(generated);
      setSaved(false);
      await refreshBatches();
    },
    onError: (error) => setFailure(describeFailure(error, "The PINs couldn't be made. Try again.")),
  });

  const voidBatch = useMutation({
    mutationFn: (batch: ResultPinBatchDto) => staffVoidResultPinBatch(batch.id),
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: async (_result, batch) => {
      setNotice(`Batch ${batch.number} voided.`);
      await refreshBatches();
    },
    onError: (error) => setFailure(describeFailure(error, "The batch couldn't be voided. Try again.")),
  });

  const voidPin = useMutation({
    mutationFn: (value: string) => staffVoidResultPin(value),
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: async (_result, value) => {
      setNotice(`PIN ${value.toUpperCase()} voided.`);
      setSerial("");
      await refreshBatches();
    },
    onError: (error) => setFailure(describeFailure(error, "That PIN couldn't be voided. Try again.")),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  if (!allowed) {
    return (
      <Screen>
        <ScreenHeader title="Result PINs" />
        <Notice tone="info">Result PIN cards are managed by owners and administrators.</Notice>
      </Screen>
    );
  }

  const school = staff?.school;
  const checkerUrl = school ? `${school.portalUrl.replace(/\/$/, "")}/result-checker/${school.slug}` : "";

  function onGenerate(): void {
    const parsed = parsePinBatchForm(quantity, maxUses);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    setFormError(null);
    if (!termId) return;
    const go = () => generate.mutate({ termId, quantity: parsed.quantity, maxUses: parsed.maxUses });
    if (unsaved) {
      Alert.alert("Discard the last batch's PINs?", "They have not been shared or printed yet, and can't be shown again.", [
        { text: "Back", style: "cancel" },
        { text: "Discard and make new", style: "destructive", onPress: go },
      ]);
    } else {
      go();
    }
  }

  async function sharePdf(): Promise<void> {
    if (!fresh || !school) return;
    setBusy("pdf");
    setFailure(null);
    let file: string | null = null;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setFailure("This phone can't share files. Use Print instead.");
        return;
      }
      const { uri } = await Print.printToFileAsync({ html: pinBatchPrintHtml(fresh, { schoolName: school.name, checkerUrl }) });
      file = uri;
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `Result PINs, batch ${fresh.batch.number}`, UTI: "com.adobe.pdf" });
      setSaved(true);
    } catch {
      setFailure("The PIN cards couldn't be shared. Try again, or print them.");
    } finally {
      if (file) await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => undefined);
      setBusy(null);
    }
  }

  async function shareCsv(): Promise<void> {
    if (!fresh) return;
    setBusy("csv");
    setFailure(null);
    const file = `${FileSystem.cacheDirectory ?? ""}${pinBatchFilename(fresh)}`;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setFailure("This phone can't share files. Use Print instead.");
        return;
      }
      // A leading BOM so Excel reads it as UTF-8, as the website's download does.
      await FileSystem.writeAsStringAsync(file, `﻿${pinBatchCsv(fresh)}`);
      await Sharing.shareAsync(file, { mimeType: "text/csv", dialogTitle: pinBatchFilename(fresh), UTI: "public.comma-separated-values-text" });
      setSaved(true);
    } catch {
      setFailure("The CSV couldn't be shared. Try again, or share the PDF.");
    } finally {
      await FileSystem.deleteAsync(file, { idempotent: true }).catch(() => undefined);
      setBusy(null);
    }
  }

  async function print(): Promise<void> {
    if (!fresh || !school) return;
    setBusy("print");
    setFailure(null);
    try {
      await Print.printAsync({ html: pinBatchPrintHtml(fresh, { schoolName: school.name, checkerUrl }) });
      setSaved(true);
    } catch {
      setFailure("The print dialog couldn't open. Try again, or share the PDF.");
    } finally {
      setBusy(null);
    }
  }

  function confirmVoidBatch(batch: ResultPinBatchDto): void {
    Alert.alert(`Void every PIN in batch ${batch.number}?`, "Cards already used keep the results they opened.", [
      { text: "Back", style: "cancel" },
      { text: "Void batch", style: "destructive", onPress: () => voidBatch.mutate(batch) },
    ]);
  }

  function confirmVoidPin(): void {
    const value = serial.trim();
    if (!value) return;
    Alert.alert(`Void PIN ${value.toUpperCase()}?`, "That card stops working straight away.", [
      { text: "Back", style: "cancel" },
      { text: "Void PIN", style: "destructive", onPress: () => voidPin.mutate(value) },
    ]);
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={batches.isRefetching} onRefresh={() => void batches.refetch()} />}
        >
          <ScreenHeader
            title="Result PINs"
            subtitle="PIN cards for classes released with “Result PIN required”. Sell or hand them out at the school."
          />

          {notice ? <Notice tone="info">{notice}</Notice> : null}
          {failure ? <Notice tone="danger">{failure}</Notice> : null}

          {fresh ? (
            <Card style={styles.card}>
              <Heading>
                Batch {fresh.batch.number}: {fresh.pins.length} PINs
              </Heading>
              <Body muted>
                {fresh.batch.termName} {fresh.batch.academicYearLabel}
              </Body>
              <Notice tone="warning">
                These PINs are shown only now. SchoolKit keeps only a scrambled copy it can&apos;t turn back into PINs.
                Share or print them before you leave this screen; if they are lost, void the batch and make a new one.
              </Notice>
              <Button title="Share cards (PDF)" loading={busy === "pdf"} disabled={busy !== null} onPress={() => void sharePdf()} />
              <Button title="Print cards" variant="secondary" loading={busy === "print"} disabled={busy !== null} onPress={() => void print()} />
              <Button title="Share as CSV" variant="secondary" loading={busy === "csv"} disabled={busy !== null} onPress={() => void shareCsv()} />
              {saved ? <Label>Saved. You can make another batch or leave.</Label> : null}
            </Card>
          ) : null}

          {canManage ? (
            <Card style={styles.card}>
              <Heading>Make a batch</Heading>
              {terms.isPending ? (
                <Skeleton lines={2} />
              ) : terms.isError ? (
                <LoadError error={terms.error} what="the school's terms" onRetry={() => void terms.refetch()} />
              ) : (terms.data?.length ?? 0) === 0 ? (
                <Notice tone="info">The school has no terms set up yet.</Notice>
              ) : (
                <>
                  <ChoiceChips
                    label="Term"
                    options={(terms.data ?? []).map((t) => ({ value: t.value, label: t.label }))}
                    value={termId}
                    onChange={setTermId}
                  />
                  <View style={styles.row}>
                    <View style={styles.half}>
                      <TextField label="How many PINs" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" maxLength={4} />
                    </View>
                    <View style={styles.half}>
                      <TextField label="Uses per PIN" value={maxUses} onChangeText={setMaxUses} keyboardType="number-pad" maxLength={2} />
                    </View>
                  </View>
                  {formError ? <Notice tone="danger">{formError}</Notice> : null}
                  <Body muted>
                    A PIN works only for the term it was made for, and only for the first student it is used for. Each
                    check on the result checker uses one; opening it in the portal or app uses one, once.
                  </Body>
                  <Button
                    title={generate.isPending ? "Making PINs…" : "Make PINs"}
                    loading={generate.isPending}
                    disabled={!termId || busy !== null}
                    onPress={onGenerate}
                  />
                </>
              )}
            </Card>
          ) : null}

          <SectionHeader title="Batches" />
          {batches.isPending ? (
            <Skeleton lines={3} />
          ) : batches.isError ? (
            <LoadError error={batches.error} what="the PIN batches" onRetry={() => void batches.refetch()} />
          ) : (batches.data?.data.length ?? 0) === 0 ? (
            <Body muted>No PINs made yet.</Body>
          ) : (
            batches.data!.data.map((batch) => (
              <Card key={batch.id} style={styles.card}>
                <Heading>
                  Batch {batch.number} · {batch.voidedAt ? "voided" : "active"}
                </Heading>
                <Body muted>
                  {batch.termName} {batch.academicYearLabel}
                </Body>
                <StatRow icon="key-outline" value={`${batch.size} PINs, ${batch.maxUses} uses each`} label="Made" />
                <StatRow icon="checkmark-circle-outline" value={`${batch.redeemedCount} used`} label={`${batch.voidedCount} voided one by one`} />
                {canManage && !batch.voidedAt ? (
                  <Button title="Void batch" variant="secondary" disabled={voidBatch.isPending} onPress={() => confirmVoidBatch(batch)} />
                ) : null}
              </Card>
            ))
          )}

          {canManage ? (
            <Card style={styles.card}>
              <Heading>Void one lost or stolen card</Heading>
              <TextField
                label="Serial on the card"
                value={serial}
                onChangeText={setSerial}
                placeholder="For example B7-0142"
                autoCapitalize="none"
              />
              <Button
                title="Void PIN"
                variant="secondary"
                loading={voidPin.isPending}
                disabled={!serial.trim() || voidPin.isPending}
                onPress={confirmVoidPin}
              />
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  card: { gap: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm },
  half: { flex: 1, minWidth: 0 },
});
