import { useState } from "react";
import { Alert, Image, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PHOTO_MAX_BYTES } from "@school-kit/types";

import { ApiError } from "../lib/api/client";
import { uploadFailureDetail } from "../lib/api/native-upload";
import { staffOwnPhotoUrl, staffUploadOwnPhoto } from "../lib/api/staff-photo";
import { useTheme } from "../theme/theme-provider";
import { radii, spacing } from "../theme/tokens";
import { SectionHeader } from "./layout";
import { Body, Button, Caption, Card } from "./ui";

// "My photo" on the staff profile (2026-10-19): the passport photo printed on
// the staff ID card. The picker's own editor crops it (passport shape on
// Android; iOS's editor crops square, and the card fills its frame from the
// centre), and asking for a quality below 1 makes it a JPEG.
export function OwnPhotoCard({ schoolId, userId }: { schoolId: string; userId: string }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const key = ["staff", schoolId, userId, "own-photo"] as const;
  const photo = useQuery({ queryKey: key, queryFn: () => staffOwnPhotoUrl(userId), staleTime: 30 * 60_000 });
  const [busy, setBusy] = useState(false);
  const url = photo.data?.urls[userId];

  async function pick(fromCamera: boolean) {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(fromCamera ? "Camera needed" : "Photos needed", "School Kit needs it to set your photo.");
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [7, 9],
      quality: 0.8,
      exif: false,
    };
    const result = fromCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > PHOTO_MAX_BYTES) {
      Alert.alert("Photo too large", "Choose a photo under 5 MB.");
      return;
    }
    setBusy(true);
    try {
      await staffUploadOwnPhoto(asset.uri);
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      Alert.alert("Photo not saved", e instanceof ApiError ? e.message : (uploadFailureDetail(e) ?? "Try again in a moment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card}>
      <SectionHeader title="My photo" />
      <View style={styles.row}>
        {url ? (
          <Image source={{ uri: url }} accessibilityLabel="Your photo" style={[styles.photo, { borderColor: colors.border }]} />
        ) : (
          <View style={[styles.photo, styles.empty, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Caption>No photo</Caption>
          </View>
        )}
        <View style={styles.actions}>
          <Body>A clear, recent passport photo for your staff ID card.</Body>
          <Button title="Take a photo" variant="secondary" loading={busy} onPress={() => void pick(true)} />
          <Button title="Choose a photo" variant="secondary" disabled={busy} onPress={() => void pick(false)} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  row: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  photo: { width: 84, height: 108, borderRadius: radii.md, borderWidth: 1 },
  empty: { alignItems: "center", justifyContent: "center" },
  actions: { flex: 1, gap: spacing.xs },
});
