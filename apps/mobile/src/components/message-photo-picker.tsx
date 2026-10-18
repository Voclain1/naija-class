import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { MESSAGE_LIMITS, type StagedMessageImageDto } from "@school-kit/types";

import { ApiError } from "../lib/api/client";
import { uploadFailureDetail } from "../lib/api/native-upload";
import { useTheme } from "../theme/theme-provider";
import { radii, spacing } from "../theme/tokens";
import { Button, Caption } from "./ui";

// Phase 9 / CP8.2 — up to 3 photos on a message (docs/modules/phase-9.md
// §17.10), for the parent app and the staff app. Each is uploaded on its own
// as it is chosen (on a weak signal, a failed photo is retried alone) and the
// message then names them.

export interface PickedPhoto {
  id: string;
  label: string;
}

export function MessagePhotoPicker({
  photos,
  onChange,
  stage,
}: {
  photos: PickedPhoto[];
  onChange: (next: PickedPhoto[]) => void;
  stage: (uri: string, mimeType: string) => Promise<StagedMessageImageDto>;
}) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  async function add(fromCamera: boolean): Promise<void> {
    const permission = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(fromCamera ? "Camera needed" : "Photos needed", fromCamera ? "School Kit needs the camera to take a photo." : "School Kit needs your photos to attach one.");
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, exif: false };
    const result = fromCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > MESSAGE_LIMITS.imageBytes) {
      Alert.alert("Photo too large", "Choose a photo under 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const staged = await stage(asset.uri, asset.mimeType ?? "image/jpeg");
      onChange([...photos, { id: staged.id, label: `Photo ${photos.length + 1}` }]);
    } catch (e) {
      Alert.alert("Photo not added", e instanceof ApiError ? e.message : (uploadFailureDetail(e) ?? "Try again in a moment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {photos.length > 0 ? (
        <View style={styles.chips}>
          {photos.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${p.label}`}
              onPress={() => onChange(photos.filter((x) => x.id !== p.id))}
              style={[styles.chip, { backgroundColor: colors.border }]}
            >
              <Caption>{p.label} ×</Caption>
            </Pressable>
          ))}
        </View>
      ) : null}
      {photos.length < MESSAGE_LIMITS.images ? (
        <View style={styles.row}>
          <Button title="Take a photo" variant="secondary" loading={busy} onPress={() => void add(true)} />
          <Button title="Choose a photo" variant="secondary" disabled={busy} onPress={() => void add(false)} />
        </View>
      ) : null}
      <Caption>Up to {MESSAGE_LIMITS.images} photos, 5 MB each.</Caption>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.md },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
