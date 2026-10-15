import { useState } from "react";
import { Alert, Linking, StyleSheet, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useMutation } from "@tanstack/react-query";
import { VACCINATION_NAME_MAX, type HealthProfileDto, type HealthVaccinationDto } from "@school-kit/types";

import { ApiError } from "../lib/api/client";
import { uploadFailureDetail } from "../lib/api/native-upload";
import {
  addStaffVaccination,
  staffVaccinationDocumentUrl,
  uploadStaffVaccinationDocument,
  withdrawStaffVaccination,
} from "../lib/api/staff-health";
import { serverToday } from "../lib/staff/server-date";
import { isoDateFromParts } from "../lib/staff/student-form";
import { spacing } from "../theme/tokens";
import { DateBoxes, TextField, type DateBoxValues } from "./form";
import { Body, Button, Caption, Card, Label } from "./ui";

// Phase 9 / CP3.2 — a child's vaccinations in the staff app, each with an
// optional document (a card photo or a PDF, up to 10 MB). "View" asks the API
// for a five-minute link (an audited read) and opens it.

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function boxesFromIso(iso: string): DateBoxValues {
  const [year = "", month = "", day = ""] = iso.split("-");
  return { day: String(Number(day)), month: String(Number(month)), year };
}

function Row({
  v,
  canEdit,
  onChanged,
}: {
  v: HealthVaccinationDto;
  canEdit: boolean;
  onChanged: (p: HealthProfileDto) => void;
}) {
  const withdrawn = v.withdrawnAt !== null;

  const upload = useMutation({
    mutationFn: (file: { uri: string; mimeType: string }) => uploadStaffVaccinationDocument(v.id, file.uri, file.mimeType),
    onSuccess: onChanged,
    onError: (e) =>
      Alert.alert(
        "Not uploaded",
        e instanceof ApiError ? e.message : (uploadFailureDetail(e) ?? "Check your connection and try again."),
      ),
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawStaffVaccination(v.id),
    onSuccess: onChanged,
    onError: (e) => Alert.alert("Not withdrawn", message(e, "We couldn't withdraw that. Try again.")),
  });

  async function view(): Promise<void> {
    try {
      const { url } = await staffVaccinationDocumentUrl(v.id);
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert("Can't open the document", message(e, "Check your connection and try again."));
    }
  }

  async function pickPhoto(): Promise<void> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photos needed", "School Kit needs your photos to attach the card.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, exif: false });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) upload.mutate({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" });
  }

  async function pickPdf(): Promise<void> {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) upload.mutate({ uri: asset.uri, mimeType: asset.mimeType ?? "application/pdf" });
  }

  function chooseDocument(): void {
    Alert.alert(v.documentType ? "Replace the document" : "Add a document", "A photo of the card, or a PDF, up to 10 MB.", [
      { text: "Photo", onPress: () => void pickPhoto() },
      { text: "PDF", onPress: () => void pickPdf() },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function confirmWithdraw(): void {
    Alert.alert("Withdraw this vaccination?", "It stays on the record, marked withdrawn.", [
      { text: "Cancel", style: "cancel" },
      { text: "Withdraw", style: "destructive", onPress: () => withdraw.mutate() },
    ]);
  }

  const busy = upload.isPending || withdraw.isPending;

  return (
    <View style={styles.row}>
      <Body muted={withdrawn}>
        {v.name}
        {withdrawn ? " (withdrawn)" : ""}
      </Body>
      <Caption>
        Given {formatDay(v.givenOn)}
        {v.recordedByName ? ` · recorded by ${v.recordedByName}` : ""}
      </Caption>
      <View style={styles.buttons}>
        {v.documentType ? (
          <Button title={`View ${v.documentType === "pdf" ? "PDF" : "photo"}`} variant="secondary" onPress={() => void view()} />
        ) : null}
        {canEdit && !withdrawn ? (
          <>
            <Button
              title={v.documentType ? "Replace document" : "Add document"}
              variant="secondary"
              loading={upload.isPending}
              disabled={busy}
              onPress={chooseDocument}
            />
            <Button title="Withdraw" variant="secondary" loading={withdraw.isPending} disabled={busy} onPress={confirmWithdraw} />
          </>
        ) : null}
      </View>
    </View>
  );
}

export function VaccinationsCard({
  profile,
  canEdit,
  onChanged,
}: {
  profile: HealthProfileDto;
  canEdit: boolean;
  onChanged: (p: HealthProfileDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const today = serverToday() ?? new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<DateBoxValues>(boxesFromIso(today));
  const [dateError, setDateError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (givenOn: string) => addStaffVaccination(profile.studentId, { name: name.trim(), givenOn }),
    onSuccess: (p) => {
      onChanged(p);
      setName("");
      setOpen(false);
    },
    onError: (e) => Alert.alert("Not saved", message(e, "We couldn't add that. Check your connection and try again.")),
  });

  function submit(): void {
    const givenOn = isoDateFromParts(date.day, date.month, date.year);
    if (!givenOn) {
      setDateError("Enter a real date: day, month, year.");
      return;
    }
    if (givenOn > today) {
      setDateError("The date can't be in the future.");
      return;
    }
    setDateError(null);
    add.mutate(givenOn);
  }

  return (
    <Card>
      <Label>Vaccinations</Label>
      {profile.vaccinations.length === 0 ? <Body muted>None recorded.</Body> : null}
      {profile.vaccinations.map((v) => (
        <Row key={v.id} v={v} canEdit={canEdit} onChanged={onChanged} />
      ))}
      {canEdit && open ? (
        <View style={styles.form}>
          <TextField
            label="Vaccine"
            value={name}
            onChangeText={setName}
            placeholder="For example, Yellow fever"
            maxLength={VACCINATION_NAME_MAX}
            autoCapitalize="sentences"
          />
          <DateBoxes label="Date given" value={date} onChange={setDate} error={dateError} />
          <View style={styles.buttons}>
            <Button title="Add" loading={add.isPending} disabled={name.trim() === ""} onPress={submit} />
            <Button title="Cancel" variant="secondary" disabled={add.isPending} onPress={() => setOpen(false)} />
          </View>
        </View>
      ) : canEdit ? (
        <Button title="Add vaccination" variant="secondary" onPress={() => setOpen(true)} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs, paddingVertical: spacing.xs },
  form: { gap: spacing.sm },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
