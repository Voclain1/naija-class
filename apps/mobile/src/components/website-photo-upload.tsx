import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";

import { WEBSITE_LIMITS, WEBSITE_NO_PUPILS_TICK, WEBSITE_PHOTO_RULE, type WebsitePhotoDto } from "@school-kit/types";

import { ApiError } from "../lib/api/client";
import { uploadFailureDetail } from "../lib/api/native-upload";
import { staffUploadWebsitePhoto } from "../lib/api/staff-website";
import { prepareWebsitePhoto } from "../lib/staff/website-photo";
import { useTheme } from "../theme/theme-provider";
import { radii, spacing } from "../theme/tokens";
import { TextField } from "./form";
import { Button, Caption } from "./ui";

// One upload control for every website photo the app adds
// (docs/modules/school-website.md W4), as on the web: the rule is written out,
// and "This photo shows no pupils" must be ticked before a photo can be taken
// or chosen. The tick clears after each upload, so it is given per photo.

/** Before 8 MB: the same limit the web states for a photo before resizing. */
const PICKED_MAX_BYTES = 8 * 1024 * 1024;

export function WebsitePhotoUpload({
  kind,
  postId,
  albumId,
  withCaption = false,
  disabled = false,
  onUploaded,
}: {
  kind: "POST" | "GALLERY";
  postId?: string;
  albumId?: string;
  withCaption?: boolean;
  disabled?: boolean;
  onUploaded: (photo: WebsitePhotoDto) => void;
}) {
  const { colors } = useTheme();
  const [ticked, setTicked] = useState(false);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const inert = disabled || busy;

  async function add(fromCamera: boolean): Promise<void> {
    const permission = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(fromCamera ? "Camera needed" : "Photos needed", fromCamera ? "School Kit needs the camera to take a photo." : "School Kit needs your photos to add one.");
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, exif: false };
    const result = fromCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > PICKED_MAX_BYTES) {
      Alert.alert("Photo too large", "Choose a photo under 8 MB.");
      return;
    }
    setBusy(true);
    try {
      const prepared = await prepareWebsitePhoto(asset);
      const photo = await staffUploadWebsitePhoto({ ...prepared, kind, postId, albumId, caption: withCaption ? caption : undefined });
      onUploaded(photo);
      setTicked(false);
      setCaption("");
    } catch (e) {
      Alert.alert("Photo not added", e instanceof ApiError ? e.message : (uploadFailureDetail(e) ?? "Try again in a moment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.wrap, { backgroundColor: colors.tileMint }]}>
      <Caption>{WEBSITE_PHOTO_RULE}</Caption>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked, disabled: inert }}
        accessibilityLabel={WEBSITE_NO_PUPILS_TICK}
        onPress={inert ? undefined : () => setTicked((t) => !t)}
        style={[styles.tick, { opacity: inert ? 0.5 : 1 }]}
      >
        <Ionicons name={ticked ? "checkbox" : "square-outline"} size={22} color={colors.primary} />
        <Text style={[styles.tickText, { color: colors.foreground }]}>{WEBSITE_NO_PUPILS_TICK}</Text>
      </Pressable>
      {withCaption ? (
        <TextField label="Caption (optional)" value={caption} onChangeText={setCaption} maxLength={WEBSITE_LIMITS.caption} />
      ) : null}
      <View style={styles.row}>
        <Button title="Take a photo" variant="secondary" loading={busy} disabled={!ticked || disabled} onPress={() => void add(true)} />
        <Button title="Choose a photo" variant="secondary" disabled={!ticked || inert} onPress={() => void add(false)} />
      </View>
      {!ticked ? <Caption>Tick the box above to add a photo.</Caption> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.md },
  tick: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  tickText: { flex: 1, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
